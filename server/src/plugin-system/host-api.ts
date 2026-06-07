import { applyPromptMacroPipeline } from '../prompt-macros/index.js'
import { runPluginComplete } from '../plugin-complete.js'
import { runPluginCompletePreflight } from '../plugin-complete-preflight.js'
import { runPluginMacroExpand } from '../plugin-macro-expand.js'
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
    async runPluginComplete(req) {
      return runPluginComplete({
        apiConfigId: req.apiConfigId,
        messages: req.messages,
        stream: false,
        responseFormat: req.responseFormat,
      })
    },
    async runPluginCompletePreflight(req) {
      const result = await runPluginCompletePreflight({
        apiConfigId: req.apiConfigId,
        messages: req.messages,
      })
      return {
        ok: result.ok,
        promptTokens: result.promptTokens,
        budget: result.budget,
        contextLength: result.contextLength,
        code: result.code,
      }
    },
    async runPluginMacroExpand(req) {
      const result = await runPluginMacroExpand({
        text: req.text,
        conversationId: req.conversationId,
        apiConfigId: req.apiConfigId,
      })
      return result.ok ? result.text : req.text
    },
  }
}
