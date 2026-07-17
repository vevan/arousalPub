/** 全局 / 会话知识库 RAG 设置（DOC/46） */

export interface KnowledgeSettings {
  enabled: boolean
  topK: number
  chunkSizeChars: number
  chunkOverlapChars: number
}

export type KnowledgeSettingsOverride = Partial<KnowledgeSettings>

export const KNOWLEDGE_SETTINGS_DEFAULTS: KnowledgeSettings = {
  enabled: true,
  topK: 4,
  chunkSizeChars: 1200,
  chunkOverlapChars: 200,
}

export const KNOWLEDGE_TOP_K_MIN = 1
export const KNOWLEDGE_TOP_K_MAX = 32
export const KNOWLEDGE_CHUNK_SIZE_MIN = 200
export const KNOWLEDGE_CHUNK_SIZE_MAX = 8000
export const KNOWLEDGE_CHUNK_OVERLAP_MIN = 0
export const KNOWLEDGE_CHUNK_OVERLAP_MAX = 2000

function clampInt(
  n: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export function normalizeKnowledgeSettings(
  raw?: Partial<KnowledgeSettings> | null,
): KnowledgeSettings {
  const d = KNOWLEDGE_SETTINGS_DEFAULTS
  const chunkSizeChars = clampInt(
    raw?.chunkSizeChars,
    KNOWLEDGE_CHUNK_SIZE_MIN,
    KNOWLEDGE_CHUNK_SIZE_MAX,
    d.chunkSizeChars,
  )
  let chunkOverlapChars = clampInt(
    raw?.chunkOverlapChars,
    KNOWLEDGE_CHUNK_OVERLAP_MIN,
    KNOWLEDGE_CHUNK_OVERLAP_MAX,
    d.chunkOverlapChars,
  )
  if (chunkOverlapChars >= chunkSizeChars) {
    chunkOverlapChars = Math.max(0, Math.floor(chunkSizeChars / 6))
  }
  return {
    enabled: raw?.enabled === false ? false : true,
    topK: clampInt(raw?.topK, KNOWLEDGE_TOP_K_MIN, KNOWLEDGE_TOP_K_MAX, d.topK),
    chunkSizeChars,
    chunkOverlapChars,
  }
}

export function resolveKnowledgeSettings(
  global: KnowledgeSettings,
  override?: KnowledgeSettingsOverride | null,
): KnowledgeSettings {
  if (!override) return normalizeKnowledgeSettings(global)
  return normalizeKnowledgeSettings({ ...global, ...override })
}

export function knowledgeSettingsOverrideFromEffective(
  effective: KnowledgeSettings,
  global: KnowledgeSettings,
): KnowledgeSettingsOverride | null {
  const o: KnowledgeSettingsOverride = {}
  if (effective.enabled !== global.enabled) o.enabled = effective.enabled
  if (effective.topK !== global.topK) o.topK = effective.topK
  if (effective.chunkSizeChars !== global.chunkSizeChars) {
    o.chunkSizeChars = effective.chunkSizeChars
  }
  if (effective.chunkOverlapChars !== global.chunkOverlapChars) {
    o.chunkOverlapChars = effective.chunkOverlapChars
  }
  return Object.keys(o).length > 0 ? o : null
}

export function parseKnowledgeSettingsPatch(
  body: unknown,
): KnowledgeSettingsOverride | null {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return null
  }
  const obj = body as Record<string, unknown>
  const patch: KnowledgeSettingsOverride = {}
  if (Object.prototype.hasOwnProperty.call(obj, 'enabled')) {
    if (typeof obj.enabled !== 'boolean') return null
    patch.enabled = obj.enabled
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'topK')) {
    if (typeof obj.topK !== 'number' || !Number.isFinite(obj.topK)) return null
    patch.topK = obj.topK
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'chunkSizeChars')) {
    if (
      typeof obj.chunkSizeChars !== 'number' ||
      !Number.isFinite(obj.chunkSizeChars)
    ) {
      return null
    }
    patch.chunkSizeChars = obj.chunkSizeChars
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'chunkOverlapChars')) {
    if (
      typeof obj.chunkOverlapChars !== 'number' ||
      !Number.isFinite(obj.chunkOverlapChars)
    ) {
      return null
    }
    patch.chunkOverlapChars = obj.chunkOverlapChars
  }
  return Object.keys(patch).length > 0 ? patch : null
}
