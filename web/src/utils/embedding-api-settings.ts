/** 与 server/src/embedding-api-settings.ts 对齐 */

export interface EmbeddingApiSettings {
  baseUrl: string
  apiKey: string
  apiKeyId?: string | null
  embeddingModel: string
  /** OpenAI 兼容 `dimensions`；null = 不传 */
  embeddingDimensions: number | null
}

export const EMBEDDING_API_SETTINGS_DEFAULTS: EmbeddingApiSettings = {
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
  return { baseUrl, apiKey, apiKeyId, embeddingModel, embeddingDimensions }
}
