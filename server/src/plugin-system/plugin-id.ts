const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isValidPluginId(pluginId: string): boolean {
  return PLUGIN_ID_RE.test(pluginId.trim())
}

export function assertValidPluginId(pluginId: string): string {
  const id = pluginId.trim()
  if (!isValidPluginId(id)) {
    throw new Error('invalid_plugin_id')
  }
  return id
}
