import { assertPluginPermission } from './plugin-permissions.js'

export function pluginAuthFailureStatus(
  code: 'plugin_not_found' | 'plugin_disabled' | 'plugin_permission_denied',
): number {
  if (code === 'plugin_not_found') return 404
  return 403
}

export async function assertPluginRoutePermission(
  pluginId: string,
  permission: string,
): Promise<
  | { ok: true }
  | {
      ok: false
      code: 'plugin_not_found' | 'plugin_disabled' | 'plugin_permission_denied'
      status: number
    }
> {
  const perm = await assertPluginPermission(pluginId, permission)
  if (!perm.ok) {
    return { ok: false, code: perm.code, status: pluginAuthFailureStatus(perm.code) }
  }
  return { ok: true }
}
