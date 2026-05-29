import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR } from './config.js'
import {
  getAuthAccessTtlSeconds,
  getAuthDefaultRefreshMs,
  getAuthIdleMs,
} from './auth-config.js'

export type SessionKind = 'persisted' | 'ephemeral'

export interface AuthSessionRecord {
  id: string
  userId: string
  kind: SessionKind
  refreshHash: string
  createdAt: string
  lastActiveAt: string
  /** 仅 persisted：滑动过期时间 ISO */
  expiresAt: string
}

interface PersistedSessionsFile {
  schemaVersion: 1
  sessions: AuthSessionRecord[]
}

let serverEpoch = Date.now()
const ephemeralByHash = new Map<string, AuthSessionRecord>()
let persistedSessions: AuthSessionRecord[] = []
let persistWriteQueue: Promise<void> = Promise.resolve()

function sessionsFilePath(): string {
  return path.join(DATA_DIR, 'auth-sessions.json')
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function getServerEpoch(): number {
  return serverEpoch
}

export function initAuthSessions(): void {
  serverEpoch = Date.now()
  ephemeralByHash.clear()
  void loadPersistedSessions()
}

async function loadPersistedSessions(): Promise<void> {
  const p = sessionsFilePath()
  if (!existsSync(p)) {
    persistedSessions = []
    return
  }
  try {
    const raw = await readFile(p, 'utf8')
    const doc = JSON.parse(raw) as Partial<PersistedSessionsFile>
    if (doc.schemaVersion !== 1 || !Array.isArray(doc.sessions)) {
      persistedSessions = []
      return
    }
    const now = Date.now()
    persistedSessions = doc.sessions.filter(
      (s) =>
        s.kind === 'persisted' &&
        typeof s.id === 'string' &&
        typeof s.userId === 'string' &&
        typeof s.refreshHash === 'string' &&
        Date.parse(s.expiresAt) > now,
    )
    if (persistedSessions.length !== doc.sessions.length) {
      queuePersistedWrite()
    }
  } catch {
    persistedSessions = []
  }
}

function queuePersistedWrite(): void {
  persistWriteQueue = persistWriteQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true })
    const doc: PersistedSessionsFile = {
      schemaVersion: 1,
      sessions: persistedSessions,
    }
    await writeFile(
      sessionsFilePath(),
      `${JSON.stringify(doc, null, 2)}\n`,
      'utf8',
    )
  })
}

function findByHash(hash: string): AuthSessionRecord | undefined {
  const ep = ephemeralByHash.get(hash)
  if (ep) return ep
  return persistedSessions.find((s) => s.refreshHash === hash)
}

function deleteById(id: string): void {
  ephemeralByHash.forEach((s, hash) => {
    if (s.id === id) ephemeralByHash.delete(hash)
  })
  const before = persistedSessions.length
  persistedSessions = persistedSessions.filter((s) => s.id !== id)
  if (persistedSessions.length !== before) queuePersistedWrite()
}

function isSessionExpired(session: AuthSessionRecord, now: number): boolean {
  const last = Date.parse(session.lastActiveAt)
  if (!Number.isFinite(last)) return true

  if (session.kind === 'ephemeral') {
    return now - last > getAuthIdleMs()
  }

  const exp = Date.parse(session.expiresAt)
  return !Number.isFinite(exp) || exp <= now
}

function touchRecord(session: AuthSessionRecord, now: number): void {
  const iso = new Date(now).toISOString()
  session.lastActiveAt = iso
  if (session.kind === 'persisted') {
    session.expiresAt = new Date(now + getAuthDefaultRefreshMs()).toISOString()
  }
}

export function touchSessionById(sessionId: string): void {
  const now = Date.now()
  for (const s of ephemeralByHash.values()) {
    if (s.id === sessionId && !isSessionExpired(s, now)) {
      touchRecord(s, now)
      return
    }
  }
  const p = persistedSessions.find((s) => s.id === sessionId)
  if (p && !isSessionExpired(p, now)) {
    touchRecord(p, now)
    queuePersistedWrite()
  }
}

export function createAuthSession(
  userId: string,
  kind: SessionKind,
): { session: AuthSessionRecord; refreshToken: string } {
  const now = Date.now()
  const refreshToken = randomBytes(32).toString('base64url')
  const refreshHash = hashRefreshToken(refreshToken)
  const session: AuthSessionRecord = {
    id: randomBytes(8).toString('hex'),
    userId,
    kind,
    refreshHash,
    createdAt: new Date(now).toISOString(),
    lastActiveAt: new Date(now).toISOString(),
    expiresAt:
      kind === 'persisted'
        ? new Date(now + getAuthDefaultRefreshMs()).toISOString()
        : new Date(now + getAuthIdleMs()).toISOString(),
  }

  if (kind === 'ephemeral') {
    ephemeralByHash.set(refreshHash, session)
  } else {
    persistedSessions.push(session)
    queuePersistedWrite()
  }

  return { session, refreshToken }
}

export function refreshAuthSession(refreshToken: string): {
  session: AuthSessionRecord
  newRefreshToken: string
} | null {
  const hash = hashRefreshToken(refreshToken)
  const session = findByHash(hash)
  if (!session) return null

  const now = Date.now()
  if (isSessionExpired(session, now)) {
    deleteById(session.id)
    return null
  }

  if (session.kind === 'ephemeral') {
    ephemeralByHash.delete(hash)
  } else {
    persistedSessions = persistedSessions.filter((s) => s.id !== session.id)
  }

  touchRecord(session, now)
  const newRefreshToken = randomBytes(32).toString('base64url')
  session.refreshHash = hashRefreshToken(newRefreshToken)

  if (session.kind === 'ephemeral') {
    ephemeralByHash.set(session.refreshHash, session)
  } else {
    persistedSessions.push(session)
    queuePersistedWrite()
  }

  return { session, newRefreshToken }
}

export function revokeRefreshToken(refreshToken: string): void {
  const hash = hashRefreshToken(refreshToken)
  const session = findByHash(hash)
  if (session) deleteById(session.id)
}

export function revokeSessionById(sessionId: string): void {
  deleteById(sessionId)
}

export function revokeAllSessionsForUser(userId: string): void {
  ephemeralByHash.forEach((s, hash) => {
    if (s.userId === userId) ephemeralByHash.delete(hash)
  })
  const before = persistedSessions.length
  persistedSessions = persistedSessions.filter((s) => s.userId !== userId)
  if (persistedSessions.length !== before) queuePersistedWrite()
}

export function getAuthAccessExpiresIn(): string {
  const sec = getAuthAccessTtlSeconds()
  if (sec >= 3600 && sec % 3600 === 0) return `${sec / 3600}h`
  if (sec >= 60 && sec % 60 === 0) return `${sec / 60}m`
  return `${sec}s`
}

export function assertJwtSessionValid(payload: {
  sid?: string
  kind?: SessionKind
  epoch?: number
}): boolean {
  if (payload.kind === 'ephemeral') {
    if (payload.epoch !== serverEpoch) return false
    if (!payload.sid) return false
    let found = false
    for (const s of ephemeralByHash.values()) {
      if (s.id === payload.sid) {
        found = true
        if (isSessionExpired(s, Date.now())) return false
        break
      }
    }
    return found
  }
  if (payload.kind === 'persisted' && payload.sid) {
    const s = persistedSessions.find((x) => x.id === payload.sid)
    if (!s || isSessionExpired(s, Date.now())) return false
    return true
  }
  return false
}
