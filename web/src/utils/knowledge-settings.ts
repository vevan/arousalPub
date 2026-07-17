/** 与 server/src/knowledge-settings.ts 对齐（Web 展示用） */

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

/** 会话 index.knowledgeSettings 是否存在覆盖（与 memory 同语义：有对象即视为覆盖） */
export function hasKnowledgeSettingsOverride(
  raw?: Partial<KnowledgeSettings> | null,
): boolean {
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
}

export function resolveKnowledgeSettings(
  global: KnowledgeSettings,
  override?: Partial<KnowledgeSettings> | null,
): KnowledgeSettings {
  const g = normalizeKnowledgeSettings(global)
  if (!override || typeof override !== 'object') return g
  return normalizeKnowledgeSettings({ ...g, ...override })
}

export function knowledgeSettingsEqual(
  a: KnowledgeSettings,
  b: KnowledgeSettings,
): boolean {
  return (
    a.enabled === b.enabled &&
    a.topK === b.topK &&
    a.chunkSizeChars === b.chunkSizeChars &&
    a.chunkOverlapChars === b.chunkOverlapChars
  )
}

export function cloneKnowledgeSettings(s: KnowledgeSettings): KnowledgeSettings {
  return { ...s }
}
