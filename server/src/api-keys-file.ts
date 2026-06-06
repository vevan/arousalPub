import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { getApiKeysPath, getUserDataDir } from './config.js'
import {
  isEncryptedSecretV1,
  resolveSecretFromDisk,
  secretToDiskFields,
  type EncryptedSecretV1,
} from './secret-encryption.js'
import { getCurrentUserId } from './user-context.js'

export interface ApiKeyEntry {
  id: string
  alias: string
  key: string
  createdAt: string
  updatedAt: string
}

export interface ApiKeysDocument {
  version: 1
  savedAt: string
  keys: ApiKeyEntry[]
}

interface ApiKeyEntryDisk {
  id: string
  alias: string
  createdAt: string
  updatedAt: string
  /** legacy 明文，迁移后不再写入 */
  key?: string
  keyEnc?: EncryptedSecretV1
}

interface ApiKeysDocumentDisk {
  version: 1
  savedAt: string
  keys: ApiKeyEntryDisk[]
}

function aadForApiKey(userId: string, keyId: string): string {
  return `arousal:${userId}:api-key:${keyId}`
}

function diskEntryToMemory(
  entry: ApiKeyEntryDisk,
  userId: string,
): ApiKeyEntry {
  const key = resolveSecretFromDisk(entry.key, entry.keyEnc, {
    aad: aadForApiKey(userId, entry.id),
  })
  return {
    id: entry.id,
    alias: entry.alias,
    key,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

function memoryEntryToDisk(
  entry: ApiKeyEntry,
  userId: string,
): ApiKeyEntryDisk {
  const { keyEnc } = secretToDiskFields(entry.key, {
    aad: aadForApiKey(userId, entry.id),
  })
  const disk: ApiKeyEntryDisk = {
    id: entry.id,
    alias: entry.alias,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
  if (keyEnc) disk.keyEnc = keyEnc
  return disk
}

function isApiKeyEntryDisk(x: unknown): x is ApiKeyEntryDisk {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false
  const o = x as Partial<ApiKeyEntryDisk>
  if (
    typeof o.id !== 'string' ||
    !o.id.length ||
    typeof o.alias !== 'string' ||
    typeof o.createdAt !== 'string' ||
    typeof o.updatedAt !== 'string'
  ) {
    return false
  }
  const hasPlain = typeof o.key === 'string'
  const hasEnc = o.keyEnc !== undefined
  if (!hasPlain && !hasEnc) return true
  if (hasPlain && typeof o.key !== 'string') return false
  if (hasEnc && !isEncryptedSecretV1(o.keyEnc)) return false
  return true
}

function normalizeDocumentFromDisk(
  o: unknown,
  userId: string,
): ApiKeysDocument | null {
  if (!o || typeof o !== 'object') return null
  const d = o as Partial<ApiKeysDocumentDisk>
  if (d.version !== 1 || !Array.isArray(d.keys)) return null
  const keys = d.keys.filter(isApiKeyEntryDisk)
  const seen = new Set<string>()
  const deduped: ApiKeyEntry[] = []
  for (const k of keys) {
    if (seen.has(k.id)) continue
    seen.add(k.id)
    deduped.push(diskEntryToMemory(k, userId))
  }
  return {
    version: 1,
    savedAt:
      typeof d.savedAt === 'string' ? d.savedAt : new Date().toISOString(),
    keys: deduped,
  }
}

function documentToDisk(
  doc: ApiKeysDocument,
  userId: string,
): ApiKeysDocumentDisk {
  return {
    version: 1,
    savedAt: doc.savedAt,
    keys: doc.keys.map((k) => memoryEntryToDisk(k, userId)),
  }
}

export async function readApiKeysDocument(): Promise<ApiKeysDocument | null> {
  try {
    const raw = await readFile(getApiKeysPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return normalizeDocumentFromDisk(parsed, getCurrentUserId())
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function writeApiKeysDocument(
  doc: ApiKeysDocument,
): Promise<void> {
  const userId = getCurrentUserId()
  await mkdir(getUserDataDir(userId), { recursive: true })
  const disk = documentToDisk(doc, userId)
  await writeFile(getApiKeysPath(), `${JSON.stringify(disk, null, 2)}\n`, 'utf8')
}

export function assertValidApiKeysPayload(body: unknown): {
  keys: ApiKeyEntry[]
} {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体须为对象')
  }
  const o = body as { keys?: unknown }
  if (!Array.isArray(o.keys)) {
    throw new Error('缺少 keys 数组')
  }
  const ids = new Set<string>()
  const out: ApiKeyEntry[] = []
  for (const k of o.keys) {
    if (!k || typeof k !== 'object' || Array.isArray(k)) {
      throw new Error('Key 条目格式无效')
    }
    const row = k as Partial<ApiKeyEntry>
    if (
      typeof row.id !== 'string' ||
      !row.id.length ||
      typeof row.alias !== 'string' ||
      typeof row.key !== 'string' ||
      typeof row.createdAt !== 'string' ||
      typeof row.updatedAt !== 'string'
    ) {
      throw new Error('Key 条目格式无效')
    }
    if (ids.has(row.id)) throw new Error('Key id 重复')
    ids.add(row.id)
    out.push({
      id: row.id,
      alias: row.alias,
      key: row.key,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }
  return { keys: out }
}
