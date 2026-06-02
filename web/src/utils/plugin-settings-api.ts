import type { PluginManageEntry } from '@/plugins/plugin-settings-types'
import { apiFetch } from '@/utils/api-fetch'
import { mergePluginLocales } from '@/plugins/merge-plugin-locales'

export async function fetchPluginsManage(): Promise<PluginManageEntry[]> {
  const res = await apiFetch('/api/plugins/manage')
  if (!res.ok) throw new Error(`plugins_manage_${res.status}`)
  const data = (await res.json()) as { plugins?: PluginManageEntry[] }
  const plugins = Array.isArray(data.plugins) ? data.plugins : []
  for (const p of plugins) {
    await mergePluginLocales(p.id)
  }
  return plugins
}

export async function savePluginRegistry(
  plugins: Array<{ id: string; enabled: boolean; order: number }>,
): Promise<void> {
  const res = await apiFetch('/api/plugins/registry', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plugins }),
  })
  if (!res.ok) throw new Error(`plugins_registry_${res.status}`)
}

export async function fetchPluginSettings(
  pluginId: string,
): Promise<Record<string, unknown>> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/settings`,
  )
  if (!res.ok) throw new Error(`plugin_settings_${res.status}`)
  const data = (await res.json()) as { settings?: Record<string, unknown> }
  return data.settings ?? {}
}

export async function savePluginSettings(
  pluginId: string,
  settings: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/settings`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    },
  )
  if (!res.ok) throw new Error(`plugin_settings_${res.status}`)
  const data = (await res.json()) as { settings?: Record<string, unknown> }
  return data.settings ?? {}
}

export function pluginI18nKey(pluginId: string, key: string): string {
  return `plugins.${pluginId}.${key}`
}

const TOKEN_KEY = 'arousal-auth-token'

export function pluginMediaUrl(
  pluginId: string,
  kind: 'assets' | 'user-assets',
  filename: string,
): string {
  const id = pluginId.trim()
  const name = filename.trim()
  if (!id || !name) return ''
  const base = `/api/plugins/${encodeURIComponent(id)}/${kind}/${encodeURIComponent(name)}`
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      return `${base}?access_token=${encodeURIComponent(token)}`
    }
  } catch {
    /* ignore */
  }
  return base
}

export async function uploadPluginUserAsset(
  pluginId: string,
  fieldKey: string,
  file: File,
): Promise<string> {
  const fd = new FormData()
  fd.append('file', file, file.name)
  fd.append('fieldKey', fieldKey)
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/user-assets`,
    { method: 'POST', body: fd },
  )
  if (!res.ok) throw new Error(`plugin_upload_${res.status}`)
  const data = (await res.json()) as { filename?: string }
  if (!data.filename) throw new Error('plugin_upload_no_filename')
  return data.filename
}
