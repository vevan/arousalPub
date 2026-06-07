import { readCharacterDocument } from './character-storage.js'
import { readConversationIndex, resolvedCharacterIds } from './chat-storage.js'
import { readAllTurns } from './chunk-chain.js'
import { isValidConversationId } from './conversation-id.js'
import { readLorebookById } from './lorebook-file.js'
import {
  buildPreviousMemoriesBlock,
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
  let prevBlock = ''
  if (includePrevious) {
    const limit =
      typeof req.previousMemoriesLimit === 'number' &&
      Number.isFinite(req.previousMemoriesLimit)
        ? Math.max(0, Math.min(50, Math.round(req.previousMemoriesLimit)))
        : 8
    try {
      const lb = await readLorebookById(targetLorebookId)
      const titles = (lb?.entries ?? [])
        .slice(-limit)
        .map((e) => (typeof e.title === 'string' ? e.title.trim() : ''))
        .filter(Boolean)
      prevBlock = buildPreviousMemoriesBlock(titles)
    } catch {
      prevBlock = ''
    }
  }

  const userContent = `${prevBlock}<history>\n${transcript}\n</history>`

  return {
    ok: true,
    userContent,
    transcript,
    turnCount: turns.length,
    meta,
  }
}
