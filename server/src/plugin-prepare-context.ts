import { readCharacterDocument } from './character-storage.js'
import { readConversationIndex, resolvedCharacterIds } from './chat-storage.js'
import { readTurnsInOrdinalRange } from './chunk-chain.js'
import { isValidConversationId } from './conversation-id.js'
import { readLorebookById } from './lorebook-file.js'
import {
  buildContextHistoryBlock,
  buildHistoryBlock,
  buildPreviousSummariesBlock,
  buildSidecarsBlock,
  resolveContextHistoryStart,
} from './plot-summary/prepare-context-blocks.js'
import {
  pickRecentSummaryEntriesBeforeTurn,
  sortPlotSummaryEntriesInGroup,
} from './plot-summary/lorebook-sort.js'
import {
  normalizeSidecarConfigIds,
  normalizeSidecarEntryIds,
} from './plugin-sidecar-refs.js'
import {
  applyOutgoingRegexToSummaryTurns,
  formatSummarizeTranscript,
  loadSummarizeOutgoingRegexRules,
  normalizeRegexRuleIds,
  PLUGIN_SUMMARIZE_BATCH_MAX,
} from './plugin-summarize-format.js'

const DEFAULT_USER = 'User'
const DEFAULT_ASSISTANT = 'Assistant'

export interface PluginPrepareContextRequest {
  conversationId: string
  fromTurn: number
  toTurn: number
  targetLorebookId: string
  includePreviousMemories?: boolean
  previousMemoriesLimit?: number
  previousSummariesLimit?: number
  sidecarEntryIds?: Record<string, string>
  sidecarIds?: string[]
  /** Historian：勾选的 outgoing 正则规则 id */
  regexRuleIds?: string[]
  /** 会话 tail ordinal，供 skipLastNTurns */
  tailOrdinal?: number
  /** 为 true 时忽略规则的 skipLastNTurns，对摘要区间内全部轮次应用正则 */
  regexApplyAllTurns?: boolean
}

export interface PluginPrepareContextSuccess {
  ok: true
  /** 参考上下文：previous-summaries + sidecars + context-history，拼入 system */
  systemReferenceContext: string
  /** 待摘要对话，仅 `<history>` 块，作为 user 消息 */
  userContent: string
  transcript: string
  turnCount: number
  meta: {
    userDisplayName: string
    assistantDisplayName: string
  }
}

export type PluginPrepareContextResult =
  | PluginPrepareContextSuccess
  | { ok: false; code: string }

async function loadAssistantDisplayName(charIds: string[]): Promise<string> {
  for (const id of charIds) {
    const doc = await readCharacterDocument(id.trim())
    if (!doc?.card || typeof doc.card !== 'object') continue
    const card = doc.card as Record<string, unknown>
    const nameRaw = card.name
    if (typeof nameRaw === 'string' && nameRaw.trim()) {
      return nameRaw.trim()
    }
  }
  return DEFAULT_ASSISTANT
}

async function resolveDisplayNames(conversationId: string): Promise<{
  userDisplayName: string
  assistantDisplayName: string
} | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const userDisplayName =
    typeof idx.userName === 'string' && idx.userName.trim()
      ? idx.userName.trim()
      : DEFAULT_USER
  const charIds = resolvedCharacterIds(idx)
  const assistantDisplayName = await loadAssistantDisplayName(charIds)
  return { userDisplayName, assistantDisplayName }
}

export async function runPluginPrepareContext(
  req: PluginPrepareContextRequest,
): Promise<PluginPrepareContextResult> {
  const conversationId =
    typeof req.conversationId === 'string' ? req.conversationId.trim() : ''
  if (!conversationId || !isValidConversationId(conversationId)) {
    return { ok: false, code: 'invalid_conversation_id' }
  }

  const fromTurn =
    typeof req.fromTurn === 'number' && Number.isInteger(req.fromTurn)
      ? req.fromTurn
      : NaN
  const toTurn =
    typeof req.toTurn === 'number' && Number.isInteger(req.toTurn)
      ? req.toTurn
      : NaN
  if (!Number.isFinite(fromTurn) || !Number.isFinite(toTurn) || fromTurn > toTurn) {
    return { ok: false, code: 'invalid_turn_range' }
  }

  const span = toTurn - fromTurn + 1
  if (span > PLUGIN_SUMMARIZE_BATCH_MAX * 20) {
    return { ok: false, code: 'turn_range_too_large' }
  }

  const targetLorebookId =
    typeof req.targetLorebookId === 'string' ? req.targetLorebookId.trim() : ''
  if (!targetLorebookId) {
    return { ok: false, code: 'target_lorebook_required' }
  }

  const meta = await resolveDisplayNames(conversationId)
  if (!meta) {
    return { ok: false, code: 'conversation_not_found' }
  }

  const includePrevious = req.includePreviousMemories !== false
  const limitRaw =
    typeof req.previousSummariesLimit === 'number'
      ? req.previousSummariesLimit
      : req.previousMemoriesLimit
  const contextLimit =
    typeof limitRaw === 'number' && Number.isFinite(limitRaw)
      ? Math.max(0, Math.min(50, Math.round(limitRaw)))
      : 8

  const historyStart = resolveContextHistoryStart(fromTurn, contextLimit)
  const rangeFrom = Math.min(historyStart, fromTurn)
  const rangeTurns = await readTurnsInOrdinalRange(
    conversationId,
    rangeFrom,
    toTurn,
  )
  const summaryTurns = rangeTurns
    .filter((t) => t.turnOrdinal >= fromTurn && t.turnOrdinal <= toTurn)
    .sort((a, b) => a.turnOrdinal - b.turnOrdinal)

  if (summaryTurns.length === 0) {
    return { ok: false, code: 'no_turns_in_range' }
  }

  const contextTurns =
    historyStart < fromTurn
      ? rangeTurns
          .filter(
            (t) =>
              t.turnOrdinal >= historyStart && t.turnOrdinal < fromTurn,
          )
          .sort((a, b) => a.turnOrdinal - b.turnOrdinal)
      : []

  const ruleIds = normalizeRegexRuleIds(req.regexRuleIds)
  const regexRules =
    ruleIds.length > 0 ? await loadSummarizeOutgoingRegexRules(ruleIds) : []
  const tailOrdinal =
    typeof req.tailOrdinal === 'number' &&
    Number.isInteger(req.tailOrdinal) &&
    req.tailOrdinal >= 0
      ? req.tailOrdinal
      : rangeTurns.reduce((max, t) => Math.max(max, t.turnOrdinal), 0)

  const regexApplyAllTurns = req.regexApplyAllTurns === true

  const regexSummaryTurns =
    regexRules.length > 0
      ? applyOutgoingRegexToSummaryTurns(
          summaryTurns,
          regexRules,
          tailOrdinal,
          regexApplyAllTurns,
        )
      : summaryTurns
  const regexContextTurns =
    regexRules.length > 0
      ? applyOutgoingRegexToSummaryTurns(
          contextTurns,
          regexRules,
          tailOrdinal,
          regexApplyAllTurns,
        )
      : contextTurns

  const contextTranscript = formatSummarizeTranscript(
    regexContextTurns,
    meta.userDisplayName,
    meta.assistantDisplayName,
  )
  const transcript = formatSummarizeTranscript(
    regexSummaryTurns,
    meta.userDisplayName,
    meta.assistantDisplayName,
  )

  const sidecarEntryIds = normalizeSidecarEntryIds(req.sidecarEntryIds)
  const sidecarConfigIds = normalizeSidecarConfigIds(req.sidecarIds)
  const sidecarEntryIdSet = new Set(Object.values(sidecarEntryIds))

  let prevBlock = ''
  let sidecarBlock = ''
  if (includePrevious) {
    try {
      const lb = await readLorebookById(targetLorebookId)
      const entries = lb?.entries ?? []

      const recent = pickRecentSummaryEntriesBeforeTurn(
        entries,
        fromTurn,
        sidecarEntryIdSet,
        contextLimit,
        sidecarEntryIds,
        sidecarConfigIds,
      )
      prevBlock = buildPreviousSummariesBlock(
        recent.map((e) => ({
          title: typeof e.title === 'string' ? e.title : '',
          content: typeof e.content === 'string' ? e.content : '',
        })),
      )

      const sidecarEntries = sortPlotSummaryEntriesInGroup(
        entries.filter((e) => sidecarEntryIdSet.has(e.id)),
        sidecarEntryIds,
        sidecarConfigIds,
      )
      sidecarBlock = buildSidecarsBlock(
        sidecarEntries.map((e) => ({
          title: typeof e.title === 'string' ? e.title : '',
          content: typeof e.content === 'string' ? e.content : '',
        })),
      )
    } catch {
      prevBlock = ''
      sidecarBlock = ''
    }
  }

  const systemReferenceContext = `${prevBlock}${sidecarBlock}${buildContextHistoryBlock(contextTranscript)}`
  const userContent = buildHistoryBlock(transcript)

  return {
    ok: true,
    systemReferenceContext,
    userContent,
    transcript,
    turnCount: summaryTurns.length,
    meta,
  }
}
