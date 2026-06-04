import type { EmbeddingApiSettings } from './embedding-api-settings.js'
import { resolveApiKeyFromEmbeddingSettings } from './embedding-credential-resolve.js'

export type EmbeddingApiSettingsPublic = Omit<EmbeddingApiSettings, 'apiKey'> & {
  keyConfigured: boolean
}

export async function sanitizeEmbeddingApiForGet(
  settings: EmbeddingApiSettings,
): Promise<EmbeddingApiSettingsPublic> {
  const { apiKey: _omit, ...rest } = settings
  const key = await resolveApiKeyFromEmbeddingSettings(settings)
  return {
    ...rest,
    keyConfigured: key.length > 0,
  }
}
