import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_IDLE_MINUTES = 15
const DEFAULT_REFRESH_DAYS = 7
const DEFAULT_ACCESS_MINUTES = 30

interface AuthConfigSlice {
  authIdleMinutes?: number | string
  authDefaultRefreshDays?: number | string
  authAccessMinutes?: number | string
}

let cached: AuthConfigSlice | null = null

function findRepoRoot(): string {
  let cur = __dirname
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(cur, 'config.example.json'))) return cur
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return path.resolve(__dirname, '..', '..')
}

function readSlice(): AuthConfigSlice {
  if (cached) return cached
  const root = findRepoRoot()
  const p = path.join(root, 'config.json')
  if (!existsSync(p)) {
    cached = {}
    return cached
  }
  try {
    const raw = readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw) as AuthConfigSlice
    cached = parsed ?? {}
    return cached
  } catch {
    cached = {}
    return cached
  }
}

function positiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export function getAuthIdleMs(): number {
  const m = positiveInt(readSlice().authIdleMinutes, DEFAULT_IDLE_MINUTES)
  return m * 60 * 1000
}

export function getAuthDefaultRefreshMs(): number {
  const d = positiveInt(readSlice().authDefaultRefreshDays, DEFAULT_REFRESH_DAYS)
  return d * 24 * 60 * 60 * 1000
}

export function getAuthAccessTtlSeconds(): number {
  const m = positiveInt(readSlice().authAccessMinutes, DEFAULT_ACCESS_MINUTES)
  return m * 60
}
