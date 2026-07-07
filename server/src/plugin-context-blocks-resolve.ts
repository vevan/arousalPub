import { readCharacterDocument } from './character-storage.js'
import {
  getTurnUserText,
  patchTurnDisplayContent,
  readConversationIndex,
  resolvedCharacterIds,
  type TurnRecord,
} from './chat-storage.js'
import { readTurnsInOrdinalRange, readTurnsTail } from './chunk-chain.js'
import { isValidConversationId } from './conversation-id.js'
import { readLorebookById } from './lorebook-file.js'
import type {
  ContextBlockSpec,
  LorebookEntrySlice,
  PluginContextBlocksRequest,
  PluginContextBlocksResult,
} from './shared/plugin-context-blocks.js'
import {
  applyOutgoingRegexToSummaryTurns,
  formatSummarizeTranscript,
  loadSummarizeOutgoingRegexRules,
  normalizeRegexRuleIds,
  PLUGIN_SUMMARIZE_BATCH_MAX,
  stripBlockTagsFromAssistant,
} from './plugin-summarize-format.js'
import { assistantTextFromTurn } from './turn-memory-xml.js'

const DEFAULT_USER = 'User'
const DEFAULT_ASSISTANT = 'Assistant'

const MAX_TRANSCRIPT_SPAN = PLUGIN_SUMMARIZE_BATCH_MAX * 20

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

function normalizeBlockId(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function normalizeStripBlockTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
}

function normalizeEntryIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
}

function formatLorebookEntryLines(
  entries: LorebookEntrySlice[],
  format: 'plain' | 'title-content-lines',
): string {
  if (entries.length === 0) return ''
  if (format === 'plain') {
    return entries
      .map((e) => (e.content ?? '').trim())
      .filter(Boolean)
      .join('\n\n')
  }
  return entries
    .map((e) => {
      const title = e.title.trim()
      const content = (e.content ?? '').trim()
      if (!title && !content) return ''
      if (!title) return content
      return `## ${title}\n${content}`
    })
    .filter(Boolean)
    .join('\n\n')
}

async function resolveLorebookEntriesBlock(
  spec: Extract<ContextBlockSpec, { source: 'lorebook.entries' }>,
): Promise<
  | { ok: true; slices: LorebookEntrySlice[]; text: string }
  | { ok: false; code: string }
> {
  const blockId = normalizeBlockId(spec.blockId)
  const lorebookId =
    typeof spec.lorebookId === 'string' ? spec.lorebookId.trim() : ''
  const entryIds = normalizeEntryIds(spec.entryIds)
  if (!blockId) return { ok: false, code: 'invalid_block_id' }
  if (!lorebookId) return { ok: false, code: 'lorebook_id_required' }
  if (entryIds.length === 0) {
    return { ok: true, slices: [], text: '' }
  }

  const lb = await readLorebookById(lorebookId)
  if (!lb) {
    // lore 读盘失败时降级为空 reference，不阻断 transcript
    return { ok: true, slices: [], text: '' }
  }

  const byId = new Map<string, LorebookEntrySlice>()
  for (const e of lb.entries ?? []) {
    if (!e || typeof e.id !== 'string') continue
    byId.set(e.id, {
      id: e.id,
      title: typeof e.title === 'string' ? e.title : '',
      content: typeof e.content === 'string' ? e.content : '',
    })
  }

  const order = spec.order === 'lorebook-file' ? 'lorebook-file' : 'as-listed'
  const orderedIds =
    order === 'lorebook-file'
      ? (lb.entries ?? [])
          .map((e) => (typeof e.id === 'string' ? e.id : ''))
          .filter((id) => entryIds.includes(id))
      : entryIds

  const slices: LorebookEntrySlice[] = []
  for (const id of orderedIds) {
    const hit = byId.get(id)
    if (hit) slices.push(hit)
  }

  const format =
    spec.format === 'plain' ? 'plain' : 'title-content-lines'
  return {
    ok: true,
    slices,
    text: formatLorebookEntryLines(slices, format),
  }
}

async function applyRegexToTurns(
  turns: TurnRecord[],
  regexRuleIds: unknown,
  regexApplyAllTurns: boolean | undefined,
  tailOrdinal: number,
): Promise<TurnRecord[]> {
  const ruleIds = normalizeRegexRuleIds(regexRuleIds)
  if (ruleIds.length === 0) return turns
  const regexRules = await loadSummarizeOutgoingRegexRules(ruleIds)
  if (regexRules.length === 0) return turns
  return applyOutgoingRegexToSummaryTurns(
    turns,
    regexRules,
    tailOrdinal,
    regexApplyAllTurns === true,
  )
}

async function resolveTranscriptBlock(
  conversationId: string,
  spec: Extract<ContextBlockSpec, { source: 'conversation.transcript' }>,
  meta: { userDisplayName: string; assistantDisplayName: string },
): Promise<
  | { ok: true; text: string; turnCount: number }
  | { ok: false; code: string }
> {
  const blockId = normalizeBlockId(spec.blockId)
  if (!blockId) return { ok: false, code: 'invalid_block_id' }

  const fromTurn =
    typeof spec.fromTurn === 'number' && Number.isInteger(spec.fromTurn)
      ? spec.fromTurn
      : NaN
  const toTurn =
    typeof spec.toTurn === 'number' && Number.isInteger(spec.toTurn)
      ? spec.toTurn
      : NaN
  if (!Number.isFinite(fromTurn) || !Number.isFinite(toTurn) || fromTurn > toTurn) {
    return { ok: false, code: 'invalid_turn_range' }
  }
  if (fromTurn < 0 || toTurn < 0) {
    return { ok: false, code: 'invalid_turn_range' }
  }

  const span = toTurn - fromTurn + 1
  if (span > MAX_TRANSCRIPT_SPAN) {
    return { ok: false, code: 'turn_range_too_large' }
  }

  const turns = await readTurnsInOrdinalRange(conversationId, fromTurn, toTurn)
  if (turns.length === 0) {
    return { ok: false, code: 'no_turns_in_range' }
  }

  const stripTags = normalizeStripBlockTags(spec.stripBlockTagsOnToTurn)
  const processedTurns =
    stripTags.length > 0
      ? turns.map((t) => {
          if (t.turnOrdinal !== toTurn) return t
          const assistant = assistantTextFromTurn(t)
          const stripped = stripBlockTagsFromAssistant(assistant, stripTags)
          if (stripped === assistant) return t
          return patchTurnDisplayContent(t, getTurnUserText(t), stripped)
        })
      : turns

  const tailOrdinal =
    typeof spec.tailOrdinal === 'number' &&
    Number.isInteger(spec.tailOrdinal) &&
    spec.tailOrdinal >= 0
      ? spec.tailOrdinal
      : turns.reduce((max, t) => Math.max(max, t.turnOrdinal), 0)

  const regexTurns = await applyRegexToTurns(
    processedTurns,
    spec.regexRuleIds,
    spec.regexApplyAllTurns,
    tailOrdinal,
  )

  const text = formatSummarizeTranscript(
    regexTurns,
    meta.userDisplayName,
    meta.assistantDisplayName,
  )

  return { ok: true, text, turnCount: regexTurns.length }
}

async function resolveTranscriptTailBlock(
  conversationId: string,
  spec: Extract<ContextBlockSpec, { source: 'conversation.transcript.tail' }>,
  meta: { userDisplayName: string; assistantDisplayName: string },
): Promise<
  | { ok: true; text: string; turnCount: number }
  | { ok: false; code: string }
> {
  const blockId = normalizeBlockId(spec.blockId)
  if (!blockId) return { ok: false, code: 'invalid_block_id' }

  const tailCount =
    typeof spec.tailCount === 'number' && Number.isFinite(spec.tailCount)
      ? Math.max(1, Math.min(500, Math.round(spec.tailCount)))
      : NaN
  if (!Number.isFinite(tailCount)) {
    return { ok: false, code: 'invalid_tail_count' }
  }

  const { turns } = await readTurnsTail(conversationId, tailCount)
  if (turns.length === 0) {
    return { ok: false, code: 'no_turns_in_range' }
  }

  const stripTags = normalizeStripBlockTags(spec.stripBlockTagsOnToTurn)
  const lastOrdinal = turns.reduce((max, t) => Math.max(max, t.turnOrdinal), 0)
  const processedTurns =
    stripTags.length > 0
      ? turns.map((t) => {
          if (t.turnOrdinal !== lastOrdinal) return t
          const assistant = assistantTextFromTurn(t)
          const stripped = stripBlockTagsFromAssistant(assistant, stripTags)
          if (stripped === assistant) return t
          return patchTurnDisplayContent(t, getTurnUserText(t), stripped)
        })
      : turns

  const tailOrdinal =
    typeof spec.tailOrdinal === 'number' &&
    Number.isInteger(spec.tailOrdinal) &&
    spec.tailOrdinal >= 0
      ? spec.tailOrdinal
      : turns.reduce((max, t) => Math.max(max, t.turnOrdinal), 0)

  const regexTurns = await applyRegexToTurns(
    processedTurns,
    spec.regexRuleIds,
    spec.regexApplyAllTurns,
    tailOrdinal,
  )

  const text = formatSummarizeTranscript(
    regexTurns,
    meta.userDisplayName,
    meta.assistantDisplayName,
  )

  return { ok: true, text, turnCount: regexTurns.length }
}

function parseContextBlockSpec(raw: unknown): ContextBlockSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const source = o.source
  const blockId = normalizeBlockId(o.blockId)
  if (!blockId) return null

  if (source === 'lorebook.entries') {
    return {
      source: 'lorebook.entries',
      blockId,
      lorebookId: typeof o.lorebookId === 'string' ? o.lorebookId : '',
      entryIds: normalizeEntryIds(o.entryIds),
      order: o.order === 'lorebook-file' ? 'lorebook-file' : 'as-listed',
      format: o.format === 'plain' ? 'plain' : 'title-content-lines',
    }
  }

  if (source === 'conversation.transcript') {
    const stripBlockTagsOnToTurn = normalizeStripBlockTags(o.stripBlockTagsOnToTurn)
    return {
      source: 'conversation.transcript',
      blockId,
      fromTurn: typeof o.fromTurn === 'number' ? o.fromTurn : NaN,
      toTurn: typeof o.toTurn === 'number' ? o.toTurn : NaN,
      regexRuleIds: Array.isArray(o.regexRuleIds) ? o.regexRuleIds : undefined,
      regexApplyAllTurns: o.regexApplyAllTurns === true,
      tailOrdinal: typeof o.tailOrdinal === 'number' ? o.tailOrdinal : undefined,
      ...(stripBlockTagsOnToTurn.length > 0 ? { stripBlockTagsOnToTurn } : {}),
    }
  }

  if (source === 'conversation.transcript.tail') {
    const stripBlockTagsOnToTurn = normalizeStripBlockTags(o.stripBlockTagsOnToTurn)
    return {
      source: 'conversation.transcript.tail',
      blockId,
      tailCount: typeof o.tailCount === 'number' ? o.tailCount : NaN,
      regexRuleIds: Array.isArray(o.regexRuleIds) ? o.regexRuleIds : undefined,
      regexApplyAllTurns: o.regexApplyAllTurns === true,
      tailOrdinal: typeof o.tailOrdinal === 'number' ? o.tailOrdinal : undefined,
      ...(stripBlockTagsOnToTurn.length > 0 ? { stripBlockTagsOnToTurn } : {}),
    }
  }

  return null
}

export function parseContextBlockSpecs(raw: unknown): ContextBlockSpec[] {
  if (!Array.isArray(raw)) return []
  const out: ContextBlockSpec[] = []
  for (const item of raw) {
    const spec = parseContextBlockSpec(item)
    if (spec) out.push(spec)
  }
  return out
}

/** 仅当 blocks 含 lore 读盘时才需 manifest `lorebook.read` */
export function contextBlockSpecsNeedLorebookRead(blocks: ContextBlockSpec[]): boolean {
  return blocks.some((spec) => spec.source === 'lorebook.entries')
}

export async function runPluginContextBlocksResolve(
  req: PluginContextBlocksRequest,
): Promise<PluginContextBlocksResult> {
  const conversationId =
    typeof req.conversationId === 'string' ? req.conversationId.trim() : ''
  if (!conversationId || !isValidConversationId(conversationId)) {
    return { ok: false, code: 'invalid_conversation_id' }
  }

  const blocks = Array.isArray(req.blocks) ? req.blocks : []
  if (blocks.length === 0) {
    return { ok: false, code: 'blocks_required' }
  }

  const meta = await resolveDisplayNames(conversationId)
  if (!meta) {
    return { ok: false, code: 'conversation_not_found' }
  }

  const blockTexts: Record<string, string> = {}
  const entriesByBlock: Record<string, LorebookEntrySlice[]> = {}
  let turnCount: number | undefined

  for (const spec of blocks) {
    if (spec.source === 'lorebook.entries') {
      const resolved = await resolveLorebookEntriesBlock(spec)
      if (!resolved.ok) return resolved
      entriesByBlock[spec.blockId] = resolved.slices
      if (resolved.text) blockTexts[spec.blockId] = resolved.text
      continue
    }

    if (spec.source === 'conversation.transcript') {
      const resolved = await resolveTranscriptBlock(conversationId, spec, meta)
      if (!resolved.ok) return resolved
      blockTexts[spec.blockId] = resolved.text
      turnCount =
        turnCount === undefined
          ? resolved.turnCount
          : Math.max(turnCount, resolved.turnCount)
      continue
    }

    if (spec.source === 'conversation.transcript.tail') {
      const resolved = await resolveTranscriptTailBlock(conversationId, spec, meta)
      if (!resolved.ok) return resolved
      blockTexts[spec.blockId] = resolved.text
      turnCount =
        turnCount === undefined
          ? resolved.turnCount
          : Math.max(turnCount, resolved.turnCount)
      continue
    }

    return { ok: false, code: 'unsupported_block_source' }
  }

  return {
    ok: true,
    blocks: blockTexts,
    entriesByBlock,
    meta: {
      ...meta,
      ...(turnCount !== undefined ? { turnCount } : {}),
    },
  }
}
