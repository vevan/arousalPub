import { applyPromptMacroPipeline } from '../prompt-macros/index.js'
import { getCurrentUserId } from '../user-context.js'
import { readMergedPluginUserSettings } from './settings.js'
import type { PluginServerHostApi } from './types.js'

export function createPluginServerHostApi(userId?: string): PluginServerHostApi {
  const uid = userId ?? getCurrentUserId()
  return {
    applyPromptMacroPipeline,
    getUserPluginSettings(pluginId: string) {
      return readMergedPluginUserSettings(pluginId, uid)
    },
  }
}
