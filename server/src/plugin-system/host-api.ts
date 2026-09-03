import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs'
import path from 'node:path'
import { applyPromptMacroPipeline } from '../prompt-macros/index.js'
import { resolvePluginCompleteApi } from '../plugin-api-resolve.js'
import { resolvePluginCaptureDebug } from '../plugin-audit-gate.js'
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
import type { RegexApplyContext } from '../regex-rules-types.js'
import { readChunkContainingOrdinal, readTurnsTail } from '../chunk-chain.js'
import { getTurnUserText } from '../chat-turn-accessors.js'
import type { TurnRecord } from '../chat-turn-types.js'
import { readConversationIndex } from '../chat-storage-io.js'
import { readConversationPluginSettings } from '../chat-storage.js'
import { readMergedPluginUserSettings } from './settings.js'
import { readPluginPackageFile } from './plugin-package-read.js'
import { getCurrentUserId } from '../user-context.js'
import { getPluginUserDataDir } from './paths.js'
import type { PluginDataApi, PluginServerHostApi } from './types.js'
import type { ChatMessage } from '../assemble-prompts.js'
import { getActiveSegmentIndex, getTurnSegments } from '../group-chat-turn.js'

export type PluginHostSegmentSnapshot = {
  id: string
  speakerCharacterId: string
  receives: { id: string; content: string }[]
  activeReceiveIndex: number
}

export type PluginHostTurnSnapshot = {
  turnOrdinal: number
  userText: string
  plugins: unknown[]
  segments: PluginHostSegmentSnapshot[]
  activeSegmentIndex: number
}

function mapTurnToHostSnapshot(t: TurnRecord): PluginHostTurnSnapshot {
  const defaultSpeaker =
    t.speakerCharacterId?.trim() ||
    t.segments[0]?.speakerCharacterId?.trim() ||
    ''
  const segments = getTurnSegments(t, defaultSpeaker).map((seg) => ({
    id: seg.id,
    speakerCharacterId: seg.speakerCharacterId,
    receives: (seg.receives ?? []).map((r) => ({
      id: typeof r.id === 'string' ? r.id : '',
      content: typeof r.content === 'string' ? r.content : '',
    })),
    activeReceiveIndex:
      typeof seg.activeReceiveIndex === 'number' ? seg.activeReceiveIndex : 0,
  }))
  return {
    turnOrdinal: t.turnOrdinal,
    userText: getTurnUserText(t),
    plugins: Array.isArray(t.plugins) ? t.plugins : [],
    segments,
    activeSegmentIndex: getActiveSegmentIndex(t),
  }
}

export function createPluginServerHostApi(
  pluginId?: string,
  userId?: string,
): PluginServerHostApi {
  const pid = pluginId?.trim() ?? ''
  const uid = userId ?? getCurrentUserId()

  /**
   * 解析 scope 根目录，守卫 conversationId 不能逃出用户数据目录。
   * 用于 list（不需要 relPath）和 resolvePluginDataPath（需要 relPath）的公共前置步骤。
   */
  function resolveScopeDir(
    scope: 'global' | 'conversation',
    conversationId?: string,
  ): string {
    if (!pid) throw new Error('plugin_id_required')
    const userDataDir = getPluginUserDataDir(pid, uid)
    const baseDataDir = path.join(userDataDir, 'data')

    if (scope === 'global') {
      return path.join(baseDataDir, 'global')
    }

    const cid = conversationId?.trim()
    if (!cid) throw new Error('missing_conversation_id')

    const convRoot = path.join(baseDataDir, 'conversations')
    const scopeDir = path.join(convRoot, cid)
    // Guard: conversationId must not escape conversations root
    const resolvedScope = path.resolve(scopeDir)
    const guard = path.resolve(convRoot) + path.sep
    if (!resolvedScope.startsWith(guard)) throw new Error('invalid_conversation_id')
    return resolvedScope
  }

  /** 解析插件 scope 数据文件完整路径，守卫 relPath 不能逃出 scopeDir */
  function resolvePluginDataPath(
    scope: 'global' | 'conversation',
    relPath: string,
    conversationId?: string,
  ): string {
    if (!relPath.trim()) throw new Error('invalid_plugin_data_path')
    const scopeDir = resolveScopeDir(scope, conversationId)
    const resolved = path.resolve(scopeDir, relPath)
    // Guard: relPath must not escape scopeDir
    const guard = path.resolve(scopeDir) + path.sep
    if (!resolved.startsWith(guard)) throw new Error('invalid_plugin_data_path')
    return resolved
  }

  const pluginData: PluginDataApi = {
    async list(scope, conversationId) {
      const scopeDir = resolveScopeDir(scope, conversationId)
      if (!existsSync(scopeDir)) return []
      return readdirSync(scopeDir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name)
    },
    async read(scope, relPath, conversationId) {
      const filePath = resolvePluginDataPath(scope, relPath, conversationId)
      if (!existsSync(filePath)) return null
      return readFileSync(filePath, 'utf8')
    },
    async write(scope, relPath, content, conversationId) {
      const filePath = resolvePluginDataPath(scope, relPath, conversationId)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, content, 'utf8')
    },
    async delete(scope, relPath, conversationId) {
      const filePath = resolvePluginDataPath(scope, relPath, conversationId)
      if (existsSync(filePath)) unlinkSync(filePath)
    },
  }

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
          fallbackToGlobalDefault: req.fallbackToGlobalDefault !== false,
        })
        if (!hit.ok) {
          return { ok: false, code: hit.code }
        }
        apiConfigId = hit.resolved.apiConfigId
        if (!modelOverride && hit.resolved.modelOverride) {
          modelOverride = hit.resolved.modelOverride
        }
      }
      const captureDebug = await resolvePluginCaptureDebug(
        req.conversationId,
        req.captureDebug === true,
      )
      return runPluginComplete({
        apiConfigId,
        messages: req.messages,
        modelOverride,
        stream: false,
        responseFormat: req.responseFormat,
        captureDebug,
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
        toTurn: req.toTurn,
        persistVars: req.persistVars,
      })
      return result.ok ? result.text : req.text
    },
    async getConversationPluginSettings(conversationId, pluginId) {
      const cid = conversationId.trim()
      const pid = pluginId.trim()
      if (!cid || !pid) return {}
      const idx = await readConversationIndex(cid)
      if (!idx) return {}
      return readConversationPluginSettings(idx, pid)
    },
    async readConversationTurnsTail(conversationId, limit = 80) {
      const cid = conversationId.trim()
      if (!cid) return []
      const cap =
        typeof limit === 'number' && Number.isFinite(limit) && limit > 0
          ? Math.min(Math.round(limit), 500)
          : 80
      const { turns } = await readTurnsTail(cid, cap)
      return turns.map(mapTurnToHostSnapshot)
    },
    async readConversationTurnAtOrdinal(conversationId, turnOrdinal) {
      const cid = conversationId.trim()
      if (!cid) return null
      if (
        typeof turnOrdinal !== 'number' ||
        !Number.isFinite(turnOrdinal) ||
        turnOrdinal < 0
      ) {
        return null
      }
      const ord = Math.round(turnOrdinal)
      const located = await readChunkContainingOrdinal(cid, ord)
      if (!located) return null
      const turn = located.chunk.turns.find((t) => t.turnOrdinal === ord)
      if (!turn) return null
      return mapTurnToHostSnapshot(turn)
    },
    async readPluginPackageText(pluginId, relPath) {
      const hit = await readPluginPackageFile(pluginId, relPath)
      return hit ? hit.body.toString('utf8') : null
    },
    async completeWithContext(req) {
      if (!pid) {
        return { ok: false, code: 'plugin_id_required' }
      }
      const { runCompleteWithContext } = await import(
        '../plugin-complete-with-context.js'
      )
      return runCompleteWithContext(pid, req, uid)
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
    pluginData,
  }
}
