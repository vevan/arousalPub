import { readApiKeysDocument } from './api-keys-file.js'
import {
  normalizeEmbeddingApiSettings,
  type EmbeddingApiSettings,
} from './embedding-api-settings.js'
import { readGlobalEmbeddingApiSettings } from './user-preferences-file.js'

export interface ResolvedEmbeddingCredentials {
  baseUrl: string
  apiKey: string
  embeddingModel: string
  embeddingDimensions: number | null
}

async function resolveApiKey(settings: EmbeddingApiSettings): Promise<string> {
  const inline = settings.apiKey?.trim()
  if (inline) return inline
  const keyId = settings.apiKeyId?.trim()
  if (!keyId) return ''
  const doc = await readApiKeysDocument()
  const hit = doc?.keys.find((k) => k.id === keyId)
  return hit?.key?.trim() ?? ''
}

async function settingsToCredentials(
  settings: EmbeddingApiSettings,
): Promise<ResolvedEmbeddingCredentials> {
  const apiKey = await resolveApiKey(settings)
  return {
    baseUrl: settings.baseUrl,
    apiKey,
    embeddingModel: settings.embeddingModel,
    embeddingDimensions: settings.embeddingDimensions,
  }
}

/** 读取 Embeddings API 连接（独立于对话 API 预设） */
export async function resolveEmbeddingApiCredentials(): Promise<ResolvedEmbeddingCredentials | null> {
  const settings = await readGlobalEmbeddingApiSettings()
  return settingsToCredentials(settings)
}

/** 测试请求：可用 body 覆盖，未传则用已保存的全局配置 */
export async function resolveEmbeddingApiCredentialsFrom(
  raw?: Partial<EmbeddingApiSettings> | null,
): Promise<ResolvedEmbeddingCredentials> {
  const settings = raw
    ? normalizeEmbeddingApiSettings(raw)
    : await readGlobalEmbeddingApiSettings()
  return settingsToCredentials(settings)
}

/** 测试/校验用 */
export function normalizeEmbeddingCredentialsFromRaw(
  raw?: Partial<EmbeddingApiSettings> | null,
): EmbeddingApiSettings {
  return normalizeEmbeddingApiSettings(raw)
}
