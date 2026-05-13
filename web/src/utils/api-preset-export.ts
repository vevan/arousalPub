/** 单条 API 预设导出文件（与 connection store 配套） */

export const API_PRESET_EXPORT_SCHEMA = 'arousal-api-preset-export@1' as const

export type ApiPresetExportDoc = {
  schema: typeof API_PRESET_EXPORT_SCHEMA
  exportedAt: string
  /** 与 ApiSettingsSnapshot 对齐；baseUrl / apiKey 可缺省（按导出时勾选） */
  apiPreset: Record<string, unknown>
  /** 勾选「关联提示词预设」且存在关联时嵌入 */
  linkedPromptPreset?: unknown
}

export function isPromptPresetLike(x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    Array.isArray(o.groups) &&
    Array.isArray(o.prompts)
  )
}

export function parseApiPresetExportDoc(raw: unknown): ApiPresetExportDoc {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('文件格式无效：应为 JSON 对象')
  }
  const o = raw as Record<string, unknown>
  if (o.schema !== API_PRESET_EXPORT_SCHEMA) {
    throw new Error(`不支持的导出格式（期望 schema: ${API_PRESET_EXPORT_SCHEMA}）`)
  }
  if (typeof o.exportedAt !== 'string' || !o.exportedAt) {
    throw new Error('文件缺少 exportedAt')
  }
  const apiPreset = o.apiPreset
  if (!apiPreset || typeof apiPreset !== 'object' || Array.isArray(apiPreset)) {
    throw new Error('文件缺少 apiPreset 对象')
  }
  const doc: ApiPresetExportDoc = {
    schema: API_PRESET_EXPORT_SCHEMA,
    exportedAt: o.exportedAt,
    apiPreset: apiPreset as Record<string, unknown>,
  }
  if ('linkedPromptPreset' in o && o.linkedPromptPreset !== undefined) {
    doc.linkedPromptPreset = o.linkedPromptPreset
  }
  return doc
}

export function exportDocHasBaseUrl(doc: ApiPresetExportDoc): boolean {
  const v = doc.apiPreset.baseUrl
  return typeof v === 'string' && v.trim().length > 0
}

export function exportDocHasApiKey(doc: ApiPresetExportDoc): boolean {
  const v = doc.apiPreset.apiKey
  return typeof v === 'string' && v.length > 0
}

export function exportDocHasLinkedPreset(doc: ApiPresetExportDoc): boolean {
  return isPromptPresetLike(doc.linkedPromptPreset)
}
