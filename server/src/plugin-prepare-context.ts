import { readCharacterDocument } from './character-storage.js'
import { readConversationIndex, resolvedCharacterIds } from './chat-storage.js'
import { readAllTurns } from './chunk-chain.js'
import { isValidConversationId } from './conversation-id.js'
import { readLorebookById } from './lorebook-file.js'
import {
  buildPreviousSummariesBlock,
  buildSidecarsBlock,
  pickRecentSummaryEntries,
  sortCuratedEntriesInGroup,
} from './plugin-curated-lorebook.js'
import {
  formatSummarizeTranscript,
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
}

export interface PluginPrepareContextSuccess {
  ok: true
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

function normalizeSidecarEntryIds(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
      out[k.trim()] = v.trim()
    }
  }
  return out
}

function normalizeSidecarIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
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

  const allTurns = await readAllTurns(conversationId)
  const turns = allTurns
    .filter((t) => t.turnOrdinal >= fromTurn && t.turnOrdinal <= toTurn)
    .sort((a, b) => a.turnOrdinal - b.turnOrdinal)

  if (turns.length === 0) {
    return { ok: false, code: 'no_turns_in_range' }
  }

  const transcript = formatSummarizeTranscript(
    turns,
    meta.userDisplayName,
    meta.assistantDisplayName,
  )

  const includePrevious = req.includePreviousMemories !== false
  const limitRaw =
    typeof req.previousSummariesLimit === 'number'
      ? req.previousSummariesLimit
      : req.previousMemoriesLimit
  const limit =
    typeof limitRaw === 'number' && Number.isFinite(limitRaw)
      ? Math.max(0, Math.min(50, Math.round(limitRaw)))
      : 8

  const sidecarEntryIds = normalizeSidecarEntryIds(req.sidecarEntryIds)
  const sidecarConfigIds = normalizeSidecarIds(req.sidecarIds)
  const sidecarEntryIdSet = new Set(Object.values(sidecarEntryIds))

  let prevBlock = ''
  let sidecarBlock = ''
  if (includePrevious) {
    try {
      const lb = await readLorebookById(targetLorebookId)
      const entries = lb?.entries ?? []

      const recent = pickRecentSummaryEntries(
        entries,
        sidecarEntryIdSet,
        limit,
        sidecarEntryIds,
        sidecarConfigIds,
      )
      prevBlock = buildPreviousSummariesBlock(
        recent.map((e) => ({
          title: typeof e.title === 'string' ? e.title : '',
          content: typeof e.content === 'string' ? e.content : '',
        })),
      )

      const sidecarEntries = sortCuratedEntriesInGroup(
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

  const userContent = `${prevBlock}${sidecarBlock}<history>\n${transcript}\n</history>`

  return {
    ok: true,
    userContent,
    transcript,
    turnCount: turns.length,
    meta,
  }
}
