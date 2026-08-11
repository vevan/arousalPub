/** 与 server/src/embedding-api-settings.ts 对齐 */

export type EmbeddingProvider = 'openai_compatible' | 'builtin'

export const BUILTIN_EMBEDDING_MODEL =
  'builtin:Xenova/paraphrase-multilingual-MiniLM-L12-v2'
export const BUILTIN_EMBEDDING_DIMENSIONS = 384
export const BUILTIN_EMBEDDING_PROFILE =
  'builtin:multilingual-minilm-l12-v2:q8:mean:l2norm:v1'

export interface EmbeddingApiSettings {
  provider: EmbeddingProvider
  baseUrl: string
  apiKey: string
  apiKeyId?: string | null
  embeddingModel: string
  /** OpenAI 兼容 `dimensions`；null = 不传 */
  embeddingDimensions: number | null
}

export const EMBEDDING_API_SETTINGS_DEFAULTS: EmbeddingApiSettings = {
  provider: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  apiKeyId: null,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: null,
}

export function normalizeEmbeddingDimensions(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n =
    typeof value === 'number'
      ? value
      : Number.parseInt(typeof value === 'string' ? value : '', 10)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.min(4096, Math.floor(n))
}

export function normalizeEmbeddingApiSettings(
  raw?: Partial<EmbeddingApiSettings> | null,
): EmbeddingApiSettings {
  const provider: EmbeddingProvider =
    raw?.provider === 'builtin' ? 'builtin' : 'openai_compatible'
  const baseUrl =
    typeof raw?.baseUrl === 'string' && raw.baseUrl.trim()
      ? raw.baseUrl.trim()
      : EMBEDDING_API_SETTINGS_DEFAULTS.baseUrl
  const apiKey = typeof raw?.apiKey === 'string' ? raw.apiKey : ''
  const apiKeyId =
    typeof raw?.apiKeyId === 'string' && raw.apiKeyId.trim()
      ? raw.apiKeyId.trim()
      : null
  const embeddingModel =
    typeof raw?.embeddingModel === 'string' && raw.embeddingModel.trim()
      ? raw.embeddingModel.trim()
      : EMBEDDING_API_SETTINGS_DEFAULTS.embeddingModel
  const embeddingDimensions = Object.prototype.hasOwnProperty.call(
    raw ?? {},
    'embeddingDimensions',
  )
    ? normalizeEmbeddingDimensions(raw?.embeddingDimensions)
    : EMBEDDING_API_SETTINGS_DEFAULTS.embeddingDimensions
  return {
    provider,
    baseUrl,
    apiKey,
    apiKeyId,
    embeddingModel,
    embeddingDimensions,
  }
}

export function resolveEmbeddingIdentity(settings: Pick<
  EmbeddingApiSettings,
  'provider' | 'embeddingModel' | 'embeddingDimensions'
>): { provider: EmbeddingProvider; embeddingModel: string; embeddingDimensions: number | null; embeddingProfile: string } {
  if (settings.provider === 'builtin') {
    return {
      provider: 'builtin',
      embeddingModel: BUILTIN_EMBEDDING_MODEL,
      embeddingDimensions: BUILTIN_EMBEDDING_DIMENSIONS,
      embeddingProfile: BUILTIN_EMBEDDING_PROFILE,
    }
  }
  const model = settings.embeddingModel.trim()
  const dimensions = settings.embeddingDimensions ?? null
  return {
    provider: 'openai_compatible',
    embeddingModel: model,
    embeddingDimensions: dimensions,
    embeddingProfile: `api:${model}:${dimensions ?? 'default'}:v1`,
  }
}

export function embeddingIndexMatchesIdentity(
  stored: { embeddingProfile?: string | null; embeddingModel?: string | null; embeddingDimensions?: number | null },
  active: ReturnType<typeof resolveEmbeddingIdentity>,
): boolean {
  if (stored.embeddingProfile?.trim()) {
    return stored.embeddingProfile.trim() === active.embeddingProfile
  }
  return active.provider === 'openai_compatible' &&
    stored.embeddingModel === active.embeddingModel &&
    (stored.embeddingDimensions ?? null) === active.embeddingDimensions
}
