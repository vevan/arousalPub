import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  readApiSettingsFromFile,
  type ApiPreset,
} from './api-settings-file.js'
import { conversationDir } from './chat-storage.js'
import { getChatsRoot } from './config.js'
import { isValidConversationId } from './conversation-id.js'
import { readUserPreferencesDocument } from './user-preferences-file.js'

export type ApiConfigReferenceKind =
  | 'conversation_api_preset'
  | 'api_preset_api_key'
  | 'embedding_api_key'

export interface ApiConfigReference {
  kind: ApiConfigReferenceKind
  /** 引用方 preset id（api_preset_api_key） */
  presetId?: string
  presetAlias?: string
  conversationId?: string
  conversationTitle?: string
  /** 对话 apiPreset 内路径，如 chat / plugins.guidance-generate */
  path?: string
}

export function extractApiConfigIdFromBinding(val: unknown): string | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null
  const id = (val as { apiConfigId?: unknown }).apiConfigId
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

/** 从会话 index.json 的 apiPreset 对象收集 apiConfigId 引用 */
export function collectApiConfigIdsFromApiPreset(
  apiPreset: unknown,
): Array<{ path: string; apiConfigId: string }> {
  const out: Array<{ path: string; apiConfigId: string }> = []
  if (!apiPreset || typeof apiPreset !== 'object' || Array.isArray(apiPreset)) {
    return out
  }
  const o = apiPreset as Record<string, unknown>
  for (const [key, val] of Object.entries(o)) {
    if (key === 'plugins' && val && typeof val === 'object' && !Array.isArray(val)) {
      for (const [pluginId, pluginVal] of Object.entries(
        val as Record<string, unknown>,
      )) {
        const id = extractApiConfigIdFromBinding(pluginVal)
        if (id) out.push({ path: `plugins.${pluginId}`, apiConfigId: id })
      }
      continue
    }
    const id = extractApiConfigIdFromBinding(val)
    if (id) out.push({ path: key, apiConfigId: id })
  }
  return out
}

interface ConversationIndexScan {
  conversationId: string
  title: string
  relPath: string
  apiPreset?: unknown
}

async function readConversationIndexAt(
  filePath: string,
  conversationId: string,
  relPath: string,
): Promise<ConversationIndexScan | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const idx = parsed as {
      title?: unknown
      apiPreset?: unknown
    }
    const title =
      typeof idx.title === 'string' && idx.title.trim()
        ? idx.title.trim()
        : conversationId
    return {
      conversationId,
      title,
      relPath,
      apiPreset: idx.apiPreset,
    }
  } catch {
    return null
  }
}

async function walkConversationIndexFiles(
  dir: string,
  conversationId: string,
  relPrefix: string,
  acc: ConversationIndexScan[],
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name
    if (ent.isDirectory()) {
      await walkConversationIndexFiles(full, conversationId, rel, acc)
    } else if (ent.isFile() && ent.name === 'index.json') {
      const hit = await readConversationIndexAt(full, conversationId, rel)
      if (hit) acc.push(hit)
    }
  }
}

export async function listConversationIndexScans(): Promise<
  ConversationIndexScan[]
> {
  const root = getChatsRoot()
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const acc: ConversationIndexScan[] = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const conversationId = ent.name
    if (!isValidConversationId(conversationId)) continue
    await walkConversationIndexFiles(
      conversationDir(conversationId),
      conversationId,
      '',
      acc,
    )
  }
  return acc
}

export function findPresetReferencesInSettings(
  presetId: string,
  settings: { activePresetId: string; presets: ApiPreset[] },
  conversationScans: ConversationIndexScan[],
): ApiConfigReference[] {
  const refs: ApiConfigReference[] = []
  const pid = presetId.trim()
  if (!pid) return refs

  for (const scan of conversationScans) {
    if (!scan.apiPreset) continue
    for (const hit of collectApiConfigIdsFromApiPreset(scan.apiPreset)) {
      if (hit.apiConfigId !== pid) continue
      const pathLabel =
        scan.relPath === 'index.json' || !scan.relPath
          ? hit.path
          : `${scan.relPath} → ${hit.path}`
      refs.push({
        kind: 'conversation_api_preset',
        conversationId: scan.conversationId,
        conversationTitle: scan.title,
        path: pathLabel,
      })
    }
  }
  return refs
}

export function findKeyReferencesInSettings(
  keyId: string,
  settings: { presets: ApiPreset[] } | null,
  embeddingApiKeyId: string | null,
): ApiConfigReference[] {
  const refs: ApiConfigReference[] = []
  const kid = keyId.trim()
  if (!kid) return refs

  for (const p of settings?.presets ?? []) {
    if (p.apiKeyId?.trim() !== kid) continue
    refs.push({
      kind: 'api_preset_api_key',
      presetId: p.id,
      presetAlias: p.alias,
    })
  }

  if (embeddingApiKeyId === kid) {
    refs.push({ kind: 'embedding_api_key' })
  }
  return refs
}

export async function findApiPresetReferences(
  presetId: string,
): Promise<ApiConfigReference[]> {
  const settings = await readApiSettingsFromFile()
  if (!settings) return []
  const preset = settings.presets.find((p) => p.id === presetId.trim())
  if (!preset) return []
  const scans = await listConversationIndexScans()
  return findPresetReferencesInSettings(presetId, settings, scans)
}

export async function findApiKeyReferences(
  keyId: string,
): Promise<ApiConfigReference[]> {
  const settings = await readApiSettingsFromFile()
  const prefs = await readUserPreferencesDocument()
  const embeddingKeyId = prefs.embeddingApi?.apiKeyId?.trim() ?? null
  return findKeyReferencesInSettings(keyId, settings, embeddingKeyId)
}

export class ApiConfigInUseError extends Error {
  constructor(
    public readonly code: string,
    public readonly references: ApiConfigReference[],
  ) {
    super(code)
  }
}

export async function deleteApiPresetFromFile(
  presetId: string,
): Promise<{ activePresetId: string }> {
  const settings = await readApiSettingsFromFile()
  if (!settings) {
    throw new ApiConfigInUseError('api_preset_not_found', [])
  }
  const pid = presetId.trim()
  const idx = settings.presets.findIndex((p) => p.id === pid)
  if (idx < 0) {
    throw new ApiConfigInUseError('api_preset_not_found', [])
  }
  if (settings.presets.length <= 1) {
    throw new ApiConfigInUseError('api_preset_last_one', [])
  }

  const refs = await findApiPresetReferences(pid)
  if (refs.length > 0) {
    throw new ApiConfigInUseError('api_preset_in_use', refs)
  }

  const nextPresets = settings.presets.filter((p) => p.id !== pid)
  let nextActive = settings.activePresetId
  if (nextActive === pid) {
    nextActive = nextPresets[0]?.id ?? nextActive
  }
  const { writeApiSettingsToFile } = await import('./api-settings-file.js')
  await writeApiSettingsToFile({
    version: 1,
    savedAt: new Date().toISOString(),
    activePresetId: nextActive,
    presets: nextPresets,
  })
  return { activePresetId: nextActive }
}

export async function deleteApiKeyFromFile(keyId: string): Promise<void> {
  const { readApiKeysDocument, writeApiKeysDocument } = await import(
    './api-keys-file.js'
  )
  const doc = await readApiKeysDocument()
  const kid = keyId.trim()
  const hit = doc?.keys.find((k) => k.id === kid)
  if (!hit) {
    throw new ApiConfigInUseError('api_key_not_found', [])
  }

  const refs = await findApiKeyReferences(kid)
  if (refs.length > 0) {
    throw new ApiConfigInUseError('api_key_in_use', refs)
  }

  const nextKeys = (doc?.keys ?? []).filter((k) => k.id !== kid)
  await writeApiKeysDocument({
    version: 1,
    savedAt: new Date().toISOString(),
    keys: nextKeys,
  })
}

/** PUT /api/api-keys 批量保存前：检测被移除的 key 是否仍被引用 */
export async function assertRemovedApiKeysNotInUse(
  incomingIds: Set<string>,
  existingKeys: Array<{ id: string }>,
): Promise<void> {
  for (const prev of existingKeys) {
    if (incomingIds.has(prev.id)) continue
    const refs = await findApiKeyReferences(prev.id)
    if (refs.length > 0) {
      throw new ApiConfigInUseError('api_key_in_use', refs)
    }
  }
}
