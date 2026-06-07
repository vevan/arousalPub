import { readPluginManifest } from './plugin-system/manifest.js'
import { readPluginRegistry } from './plugin-system/registry.js'

export async function assertPluginEnabled(
  pluginId: string,
): Promise<{ ok: true } | { ok: false; code: 'plugin_not_found' | 'plugin_disabled' }> {
  const id = pluginId.trim()
  if (!id) return { ok: false, code: 'plugin_not_found' }
  const manifest = await readPluginManifest(id)
  if (!manifest) return { ok: false, code: 'plugin_not_found' }
  const registry = await readPluginRegistry()
  const entry = registry.plugins.find((p) => p.id === id)
  if (!entry?.enabled) return { ok: false, code: 'plugin_disabled' }
  return { ok: true }
}

export async function assertPluginPermission(
  pluginId: string,
  permission: string,
): Promise<
  | { ok: true }
  | {
      ok: false
      code: 'plugin_not_found' | 'plugin_disabled' | 'plugin_permission_denied'
    }
> {
  const enabled = await assertPluginEnabled(pluginId)
  if (!enabled.ok) return enabled
  const manifest = await readPluginManifest(pluginId)
  const perms = manifest?.permissions ?? []
  if (!perms.includes(permission)) {
    return { ok: false, code: 'plugin_permission_denied' }
  }
  return { ok: true }
}
