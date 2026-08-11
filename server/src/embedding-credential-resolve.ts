import { resolveKeyFromKeychain } from './api-credential-resolve.js'
import {
  mergeEmbeddingApiPatch,
  normalizeEmbeddingApiSettings,
  type EmbeddingApiSettings,
} from './embedding-api-settings.js'
import { readGlobalEmbeddingApiSettings } from './user-preferences-file.js'
import {
  BUILTIN_EMBEDDING_DEVICE,
  BUILTIN_EMBEDDING_DIMENSIONS,
  BUILTIN_EMBEDDING_DTYPE,
  BUILTIN_EMBEDDING_MODEL,
  BUILTIN_EMBEDDING_MODEL_ID,
  BUILTIN_EMBEDDING_MODEL_REVISION,
  BUILTIN_EMBEDDING_PROFILE,
} from './builtin-embedding.js'

export interface ResolvedOpenAIEmbeddingCredentials {
  provider: 'openai_compatible'
  baseUrl: string
  apiKey: string
  embeddingModel: string
  embeddingDimensions: number | null
  embeddingProfile: string
}

export interface ResolvedBuiltinEmbeddingCredentials {
  provider: 'builtin'
  embeddingModel: string
  embeddingDimensions: number
  embeddingProfile: string
  modelId: string
  revision: string
  dtype: typeof BUILTIN_EMBEDDING_DTYPE
  device: typeof BUILTIN_EMBEDDING_DEVICE
}

/** 兼容旧命名；现在是 Provider 判别联合，不再只表示 HTTP 凭据。 */
export type ResolvedEmbeddingCredentials =
  | ResolvedOpenAIEmbeddingCredentials
  | ResolvedBuiltinEmbeddingCredentials

function embeddingEndpointFingerprint(baseUrl: string): string {
  let endpoint = baseUrl.trim().replace(/\/+$/, '').replace(/\/embeddings$/i, '')
  if (!endpoint.endsWith('/v1')) endpoint = `${endpoint}/v1`
  try {
    const parsed = new URL(endpoint)
    parsed.username = ''
    parsed.password = ''
    endpoint = parsed.toString()
  } catch {
    // URL validation happens before requests. Keep profile generation total so
    // settings can still be normalized and reported to the UI.
  }

  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(endpoint)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function embeddingApiProfile(
  baseUrl: string,
  model: string,
  dimensions: number | null,
): string {
  return `api:${embeddingEndpointFingerprint(baseUrl)}:${model.trim()}:${dimensions ?? 'default'}:v2`
}

export async function resolveApiKeyFromEmbeddingSettings(
  settings: EmbeddingApiSettings,
): Promise<string> {
  if (settings.provider === 'builtin') return ''
  const inline = settings.apiKey?.trim()
  if (inline) return inline
  const keyId = settings.apiKeyId?.trim()
  if (!keyId) return ''
  return resolveKeyFromKeychain(keyId)
}

async function settingsToCredentials(
  settings: EmbeddingApiSettings,
): Promise<ResolvedEmbeddingCredentials> {
  if (settings.provider === 'builtin') {
    return {
      provider: 'builtin',
      embeddingModel: BUILTIN_EMBEDDING_MODEL,
      embeddingDimensions: BUILTIN_EMBEDDING_DIMENSIONS,
      embeddingProfile: BUILTIN_EMBEDDING_PROFILE,
      modelId: BUILTIN_EMBEDDING_MODEL_ID,
      revision: BUILTIN_EMBEDDING_MODEL_REVISION,
      dtype: BUILTIN_EMBEDDING_DTYPE,
      device: BUILTIN_EMBEDDING_DEVICE,
    }
  }
  const apiKey = await resolveApiKeyFromEmbeddingSettings(settings)
  return {
    provider: 'openai_compatible',
    baseUrl: settings.baseUrl,
    apiKey,
    embeddingModel: settings.embeddingModel,
    embeddingDimensions: settings.embeddingDimensions,
    embeddingProfile: embeddingApiProfile(
      settings.baseUrl,
      settings.embeddingModel,
      settings.embeddingDimensions,
    ),
  }
}

/** 读取有效 Embedding Provider（独立于对话 API 预设）。 */
export async function resolveEmbeddingApiCredentials(
  conversationId?: string | null,
): Promise<ResolvedEmbeddingCredentials> {
  const settings = await readGlobalEmbeddingApiSettings()
  if (conversationId?.trim() && settings.provider !== 'builtin') {
    const { readConversationIndex } = await import('./chat-storage.js')
    const { resolveConversationEmbeddingModelSettings } = await import(
      './conversation-api-settings.js'
    )
    const idx = await readConversationIndex(conversationId.trim())
    const modelPart = resolveConversationEmbeddingModelSettings(
      settings,
      idx?.embeddingApiSettings,
    )
    return settingsToCredentials({ ...settings, ...modelPart })
  }
  return settingsToCredentials(settings)
}

/** 测试请求：可用 body 覆盖，未传则用已保存的全局配置。 */
export async function resolveEmbeddingApiCredentialsFrom(
  raw?: Partial<EmbeddingApiSettings> | null,
): Promise<ResolvedEmbeddingCredentials> {
  const saved = await readGlobalEmbeddingApiSettings()
  const settings = raw
    ? normalizeEmbeddingApiSettings(mergeEmbeddingApiPatch(saved, raw))
    : saved
  return settingsToCredentials(settings)
}

/** 测试/校验用。 */
export function normalizeEmbeddingCredentialsFromRaw(
  raw?: Partial<EmbeddingApiSettings> | null,
): EmbeddingApiSettings {
  return normalizeEmbeddingApiSettings(raw)
}
