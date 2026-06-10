import { applyPromptMacroPipeline } from '../prompt-macros/index.js'
import { resolvePluginCompleteApi } from '../plugin-api-resolve.js'
import { runPluginComplete } from '../plugin-complete.js'
import { runPluginCompletePreflight } from '../plugin-complete-preflight.js'
import { runPluginMacroExpand } from '../plugin-macro-expand.js'
import {
  applyRegexRulesToMessages,
  applyRegexRulesToText,
  filterRegexRules,
  toRegexRuleSummary,
} from '../regex-apply.js'
import { readRegexRulesDocument } from '../regex-rules-file.js'
import type {
  RegexApplyContext,
} from '../regex-rules-types.js'
import { getCurrentUserId } from '../user-context.js'
import { readMergedPluginUserSettings } from './settings.js'
import type { PluginServerHostApi } from './types.js'
import type { ChatMessage } from '../assemble-prompts.js'

export function createPluginServerHostApi(
  pluginId?: string,
  userId?: string,
): PluginServerHostApi {
  const pid = pluginId?.trim() ?? ''
  const uid = userId ?? getCurrentUserId()
  return {
    applyPromptMacroPipeline,
    getUserPluginSettings(pluginId: string) {
      return readMergedPluginUserSettings(pluginId, uid)
    },
    async runPluginComplete(req) {
      let apiConfigId =
        typeof req.apiConfigId === 'string' ? req.apiConfigId.trim() : ''
      let modelOverride = req.modelOverride
      if (!apiConfigId) {
        if (!pid) {
          return { ok: false, code: 'api_config_not_found' }
        }
        const hit = await resolvePluginCompleteApi({
          pluginId: pid,
          userId: uid,
          conversationId: req.conversationId,
        })
        if (!hit.ok) {
          return { ok: false, code: hit.code }
        }
        apiConfigId = hit.resolved.apiConfigId
        if (!modelOverride && hit.resolved.modelOverride) {
          modelOverride = hit.resolved.modelOverride
        }
      }
      return runPluginComplete({
        apiConfigId,
        messages: req.messages,
        modelOverride,
        stream: false,
        responseFormat: req.responseFormat,
      })
    },
    async runPluginCompletePreflight(req) {
      let apiConfigId =
        typeof req.apiConfigId === 'string' ? req.apiConfigId.trim() : ''
      if (!apiConfigId) {
        if (!pid) {
          return {
            ok: false,
            promptTokens: 0,
            budget: 0,
            contextLength: null,
            code: 'api_config_not_found',
          }
        }
        const hit = await resolvePluginCompleteApi({
          pluginId: pid,
          userId: uid,
          conversationId: req.conversationId,
        })
        if (!hit.ok) {
          return {
            ok: false,
            promptTokens: 0,
            budget: 0,
            contextLength: null,
            code: hit.code,
          }
        }
        apiConfigId = hit.resolved.apiConfigId
      }
      const result = await runPluginCompletePreflight({
        apiConfigId,
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
    regex: {
      async listRules(opts) {
        const doc = await readRegexRulesDocument(uid)
        const rules = filterRegexRules(doc.rules, { phases: opts?.phases })
        return rules.map(toRegexRuleSummary)
      },
      async applyText(text, ruleIds, ctx: RegexApplyContext) {
        const doc = await readRegexRulesDocument(uid)
        const rules = filterRegexRules(doc.rules, { ruleIds })
        return applyRegexRulesToText(text, rules, ctx)
      },
      async applyMessages(messages, ruleIds, ctx) {
        const doc = await readRegexRulesDocument(uid)
        const rules = filterRegexRules(doc.rules, { ruleIds })
        return applyRegexRulesToMessages(
          messages as ChatMessage[],
          rules,
          ctx,
        ) as ChatMessage[]
      },
    },
  }
}
