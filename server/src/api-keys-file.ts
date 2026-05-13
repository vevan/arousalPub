import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { API_KEYS_PATH, DATA_DIR } from './config.js'

export { API_KEYS_PATH }

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

function isApiKeyEntry(x: unknown): x is ApiKeyEntry {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false
  const o = x as Partial<ApiKeyEntry>
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.alias === 'string' &&
    typeof o.key === 'string' &&
    typeof o.createdAt === 'string' &&
    typeof o.updatedAt === 'string'
  )
}

function normalizeDocument(o: unknown): ApiKeysDocument | null {
  if (!o || typeof o !== 'object') return null
  const d = o as Partial<ApiKeysDocument>
  if (d.version !== 1 || !Array.isArray(d.keys)) return null
  const keys = d.keys.filter(isApiKeyEntry)
  const seen = new Set<string>()
  const deduped: ApiKeyEntry[] = []
  for (const k of keys) {
    if (seen.has(k.id)) continue
    seen.add(k.id)
    deduped.push(k)
  }
  return {
    version: 1,
    savedAt:
      typeof d.savedAt === 'string' ? d.savedAt : new Date().toISOString(),
    keys: deduped,
  }
}

export async function readApiKeysDocument(): Promise<ApiKeysDocument | null> {
  try {
    const raw = await readFile(API_KEYS_PATH, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return normalizeDocument(parsed)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function writeApiKeysDocument(
  doc: ApiKeysDocument,
): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(API_KEYS_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
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
    if (!isApiKeyEntry(k)) throw new Error('Key 条目格式无效')
    if (ids.has(k.id)) throw new Error('Key id 重复')
    ids.add(k.id)
    out.push(k)
  }
  return { keys: out }
}
