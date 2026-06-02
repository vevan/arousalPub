export interface TurnPluginEntry {
  pluginId: string
  schemaVersion: number
  payload: Record<string, unknown>
}

export type ChatPluginsBody = Record<string, unknown>
