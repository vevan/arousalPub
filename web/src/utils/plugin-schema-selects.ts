import { apiFetch } from '@/utils/api-fetch'

export interface PluginSchemaSelectItem {
  title: string
  value: string
}

export async function loadApiPresetSelectItems(): Promise<PluginSchemaSelectItem[]> {
  const res = await apiFetch('/api/settings')
  if (!res.ok) return []
  const data = (await res.json()) as { presets?: unknown[] }
  if (!Array.isArray(data.presets)) return []
  return data.presets
    .map((p) => {
      if (!p || typeof p !== 'object') return null
      const o = p as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id : ''
      const alias = typeof o.alias === 'string' ? o.alias.trim() : ''
      if (!id) return null
      return { value: id, title: alias || id }
    })
    .filter((x): x is PluginSchemaSelectItem => x !== null)
}

export async function loadLorebookSelectItems(): Promise<PluginSchemaSelectItem[]> {
  const res = await apiFetch('/api/lorebooks/summary')
  if (!res.ok) return []
  const data = (await res.json()) as { lorebooks?: unknown[] }
  if (!Array.isArray(data.lorebooks)) return []
  return data.lorebooks
    .map((lb) => {
      if (!lb || typeof lb !== 'object') return null
      const o = lb as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id : ''
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      if (!id) return null
      return { value: id, title: name || id }
    })
    .filter((x): x is PluginSchemaSelectItem => x !== null)
}

export function needsApiPresetSelect(
  fields: { type?: string }[],
): boolean {
  return fields.some((f) => f.type === 'apiPreset')
}

export function needsLorebookSelect(fields: { type?: string }[]): boolean {
  return fields.some((f) => f.type === 'lorebook')
}
