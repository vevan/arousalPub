import {
  assertValidPresets,
  type ApiPreset,
  type ApiSettingsDocument,
} from './api-settings-file.js'
import { isApiKeyConfiguredForPreset } from './api-credential-resolve.js'

export type ApiPresetPublic = Omit<ApiPreset, 'apiKey'> & {
  keyConfigured: boolean
}

export type ApiSettingsDocumentPublic = Omit<ApiSettingsDocument, 'presets'> & {
  presets: ApiPresetPublic[]
}

export async function sanitizeApiSettingsDocumentForGet(
  doc: ApiSettingsDocument,
): Promise<ApiSettingsDocumentPublic> {
  const presets = await Promise.all(
    doc.presets.map(async (p) => {
      const { apiKey: _omit, ...rest } = p
      return {
        ...rest,
        keyConfigured: await isApiKeyConfiguredForPreset(p),
      }
    }),
  )
  return {
    version: doc.version,
    savedAt: doc.savedAt,
    activePresetId: doc.activePresetId,
    presets,
  }
}

export type ApiPresetPut = Omit<ApiPreset, 'apiKey'> & {
  apiKey?: string
}

export interface ApiSettingsPutBody {
  activePresetId: string
  presets: ApiPresetPut[]
}

export async function mergeApiSettingsPut(
  body: ApiSettingsPutBody,
): Promise<ApiSettingsDocument> {
  const { readApiSettingsFromFile } = await import('./api-settings-file.js')
  const existing = await readApiSettingsFromFile()
  const prevById = new Map((existing?.presets ?? []).map((p) => [p.id, p]))
  const savedAt = new Date().toISOString()

  const presets: ApiPreset[] = body.presets.map((incoming) => {
    const prev = prevById.get(incoming.id)
    const base = prev ?? ({
      ...incoming,
      apiKey: '',
    } as ApiPreset)

    let apiKey = base.apiKey
    if (Object.prototype.hasOwnProperty.call(incoming, 'apiKey')) {
      apiKey = incoming.apiKey ?? ''
    }

    return {
      ...base,
      ...incoming,
      apiKey,
    }
  })

  assertValidPresets(presets)

  return {
    version: 1,
    savedAt,
    activePresetId: body.activePresetId,
    presets,
  }
}
