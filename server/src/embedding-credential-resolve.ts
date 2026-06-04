import { resolveKeyFromKeychain } from './api-credential-resolve.js'

import {

  mergeEmbeddingApiPatch,

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



export async function resolveApiKeyFromEmbeddingSettings(

  settings: EmbeddingApiSettings,

): Promise<string> {

  const inline = settings.apiKey?.trim()

  if (inline) return inline

  const keyId = settings.apiKeyId?.trim()

  if (!keyId) return ''

  return resolveKeyFromKeychain(keyId)

}



async function settingsToCredentials(

  settings: EmbeddingApiSettings,

): Promise<ResolvedEmbeddingCredentials> {

  const apiKey = await resolveApiKeyFromEmbeddingSettings(settings)

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



/** 测试请求：可用 body 覆盖，未传则用已保存的全局配置；省略 apiKey 保留磁盘 */

export async function resolveEmbeddingApiCredentialsFrom(

  raw?: Partial<EmbeddingApiSettings> | null,

): Promise<ResolvedEmbeddingCredentials> {

  const saved = await readGlobalEmbeddingApiSettings()

  const settings = raw

    ? normalizeEmbeddingApiSettings(mergeEmbeddingApiPatch(saved, raw))

    : saved

  return settingsToCredentials(settings)

}



/** 测试/校验用 */

export function normalizeEmbeddingCredentialsFromRaw(

  raw?: Partial<EmbeddingApiSettings> | null,

): EmbeddingApiSettings {

  return normalizeEmbeddingApiSettings(raw)

}


