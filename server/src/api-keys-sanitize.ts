import type { ApiKeyEntry, ApiKeysDocument } from './api-keys-file.js'
import { isApiKeyConfiguredForEntry } from './api-credential-resolve.js'

export interface ApiKeyEntryPublic {
  id: string
  alias: string
  createdAt: string
  updatedAt: string
  keyConfigured: boolean
}

export interface ApiKeysDocumentPublic {
  version: 1
  savedAt: string
  keys: ApiKeyEntryPublic[]
}

export function sanitizeApiKeyEntryForGet(entry: ApiKeyEntry): ApiKeyEntryPublic {
  return {
    id: entry.id,
    alias: entry.alias,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    keyConfigured: isApiKeyConfiguredForEntry(entry),
  }
}

export function sanitizeApiKeysDocumentForGet(
  doc: ApiKeysDocument,
): ApiKeysDocumentPublic {
  return {
    version: doc.version,
    savedAt: doc.savedAt,
    keys: doc.keys.map(sanitizeApiKeyEntryForGet),
  }
}

export interface ApiKeyPutEntry {
  id: string
  alias: string
  key?: string
}

export function parseApiKeysPutPayload(body: unknown): { keys: ApiKeyPutEntry[] } {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体须为对象')
  }
  const o = body as { keys?: unknown }
  if (!Array.isArray(o.keys)) {
    throw new Error('缺少 keys 数组')
  }
  const ids = new Set<string>()
  const out: ApiKeyPutEntry[] = []
  for (const raw of o.keys) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Key 条目格式无效')
    }
    const k = raw as Record<string, unknown>
    if (typeof k.id !== 'string' || !k.id.trim()) {
      throw new Error('Key 条目格式无效')
    }
    if (typeof k.alias !== 'string') {
      throw new Error('Key 条目格式无效')
    }
    if (ids.has(k.id)) throw new Error('Key id 重复')
    ids.add(k.id)
    const entry: ApiKeyPutEntry = {
      id: k.id.trim(),
      alias: k.alias.trim(),
    }
    if (Object.prototype.hasOwnProperty.call(k, 'key')) {
      if (typeof k.key !== 'string') throw new Error('Key 条目 key 须为字符串')
      entry.key = k.key
    }
    out.push(entry)
  }
  return { keys: out }
}

export async function mergeApiKeysPutPayload(
  incoming: ApiKeyPutEntry[],
): Promise<ApiKeyEntry[]> {
  const { readApiKeysDocument } = await import('./api-keys-file.js')
  const existing = await readApiKeysDocument()
  const byId = new Map((existing?.keys ?? []).map((k) => [k.id, k]))
  const now = new Date().toISOString()
  const out: ApiKeyEntry[] = []

  for (const row of incoming) {
    const prev = byId.get(row.id)
    let key: string
    if (Object.prototype.hasOwnProperty.call(row, 'key')) {
      key = row.key ?? ''
    } else if (prev) {
      key = prev.key
    } else {
      throw new Error('新建 Key 条目须提供 key')
    }
    out.push({
      id: row.id,
      alias: row.alias,
      key,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    })
  }
  return out
}
