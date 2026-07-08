export class PluginPermissionDeniedError extends Error {
  readonly pluginId: string
  readonly permission: string

  constructor(pluginId: string, permission: string) {
    super(`plugin_permission_denied:${pluginId}:${permission}`)
    this.name = 'PluginPermissionDeniedError'
    this.pluginId = pluginId
    this.permission = permission
  }
}

export function pluginHasPermission(
  permissions: readonly string[] | undefined,
  permission: string,
): boolean {
  return permissions?.includes(permission) ?? false
}

export function assertPluginPermission(
  pluginId: string,
  permissions: readonly string[] | undefined,
  permission: string,
): void {
  if (!pluginHasPermission(permissions, permission)) {
    throw new PluginPermissionDeniedError(pluginId, permission)
  }
}
