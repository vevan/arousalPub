import { getTurnUserText, type TurnRecord } from '../chat-storage.js'
import { assistantTextFromTurn } from '../turn-memory-xml.js'

export interface FlatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
  turnId: string
  turnOrdinal: number
  receiveId?: string
  receiveIndex?: number
}

export interface MacroHistoryFields {
  lastMessage: string
  lastUserMessage: string
  lastCharMessage: string
  lastMessageId: string
  firstIncludedMessageId: string
  allChatRange: string
  lastSwipeId: string
  currentSwipeId: string
  notChar: string
  /** ST idleDuration：参照的上一条用户消息 createdAt（ISO） */
  idleReferenceUserAt?: string
}

const EMPTY_HISTORY_FIELDS: MacroHistoryFields = {
  lastMessage: '',
  lastUserMessage: '',
  lastCharMessage: '',
  lastMessageId: '0',
  firstIncludedMessageId: '0',
  allChatRange: '0-0',
  lastSwipeId: '0',
  currentSwipeId: '0',
  notChar: '',
}

export function flattenTurnsToChatMessages(
  turns: TurnRecord[],
): FlatHistoryMessage[] {
  const out: FlatHistoryMessage[] = []
  for (const turn of turns) {
    const user = getTurnUserText(turn).trim()
    if (user) {
      out.push({
        role: 'user',
        content: user,
        turnId: turn.turnId,
        turnOrdinal: turn.turnOrdinal,
      })
    }
    const assistant = assistantTextFromTurn(turn).trim()
    if (assistant) {
      const receives = turn.receives ?? []
      const activeIdx = Math.min(
        Math.max(0, Math.floor(turn.activeReceiveIndex) || 0),
        Math.max(0, receives.length - 1),
      )
      const rec = receives[activeIdx]
      out.push({
        role: 'assistant',
        content: assistant,
        turnId: turn.turnId,
        turnOrdinal: turn.turnOrdinal,
        receiveId: rec?.id,
        receiveIndex: activeIdx,
      })
    }
  }
  return out
}

function swipeFieldsForTurn(turn: TurnRecord | null | undefined): {
  lastSwipeId: string
  currentSwipeId: string
} {
  if (!turn) return { lastSwipeId: '0', currentSwipeId: '0' }
  const receives = turn.receives ?? []
  if (receives.length === 0) return { lastSwipeId: '0', currentSwipeId: '0' }
  const activeIdx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex) || 0),
    receives.length - 1,
  )
  return {
    lastSwipeId: String(receives.length),
    currentSwipeId: String(activeIdx + 1),
  }
}

export interface TrimmedHistoryMessage {
  role: 'user' | 'assistant'
  content: string
  turnId?: string
  turnOrdinal?: number
  receiveId?: string
  receiveIndex?: number
}

function flatIndexOfHistoryStart(
  allFlat: FlatHistoryMessage[],
  historyTurns: TurnRecord[],
): number {
  if (historyTurns.length === 0) return 0
  const firstTurnId = historyTurns[0]!.turnId
  const idx = allFlat.findIndex((m) => m.turnId === firstTurnId)
  return idx >= 0 ? idx : 0
}

function historyMessageMetaMatches(
  flat: FlatHistoryMessage,
  msg: TrimmedHistoryMessage,
): boolean {
  if (flat.role !== msg.role) return false
  if (!msg.turnId || flat.turnId !== msg.turnId) return false
  if (msg.role === 'assistant') {
    if (msg.receiveId && flat.receiveId && flat.receiveId !== msg.receiveId) {
      return false
    }
    if (
      typeof msg.receiveIndex === 'number' &&
      typeof flat.receiveIndex === 'number' &&
      flat.receiveIndex !== msg.receiveIndex
    ) {
      return false
    }
  }
  return true
}

function flatIndexByTurnMetadata(
  allFlat: FlatHistoryMessage[],
  msg: TrimmedHistoryMessage,
): number {
  if (!msg.turnId) return -1
  return allFlat.findIndex((m) => historyMessageMetaMatches(m, msg))
}

/** budget trim 后首条 history 在 indexing 全量 flat 中的下标 */
function resolveFirstIncludedMessageId(
  allFlat: FlatHistoryMessage[],
  historyTurns: TurnRecord[],
  trimmed?: TrimmedHistoryMessage[],
): string {
  if (!trimmed?.length) return '0'
  const first = trimmed[0]!

  const metaIdx = flatIndexByTurnMetadata(allFlat, first)
  if (metaIdx >= 0) return String(metaIdx)

  const historyFlat = flattenTurnsToChatMessages(historyTurns)
  if (historyFlat.length === 0) return '0'

  const trimmedLen = trimmed.length
  if (historyFlat.length >= trimmedLen) {
    const suffix = historyFlat.slice(-trimmedLen)
    let suffixMatches = true
    for (let i = 0; i < trimmedLen; i++) {
      const h = suffix[i]!
      const t = trimmed[i]!
      if (h.role !== t.role || h.content !== t.content) {
        suffixMatches = false
        break
      }
    }
    if (suffixMatches) {
      const dropped = historyFlat.length - trimmedLen
      const idx = flatIndexOfHistoryStart(allFlat, historyTurns) + dropped
      return String(Math.min(idx, Math.max(0, allFlat.length - 1)))
    }

    const firstSuffix = suffix[0]!
    const suffixMetaIdx = flatIndexByTurnMetadata(allFlat, firstSuffix)
    if (suffixMetaIdx >= 0) return String(suffixMetaIdx)
  }

  const idx = allFlat.findIndex(
    (m) => m.role === first.role && m.content === first.content,
  )
  return String(idx >= 0 ? idx : 0)
}

/**
 * ST `idleDuration` 参照时刻：自尾部向前，跳过末尾一条非用户消息后取最近一条用户消息的 createdAt。
 * 与 ST `getTimeSinceLastMessage` 一致（不含本轮尚未落盘的用户 input）。
 */
export function findIdleReferenceUserAt(
  turns: TurnRecord[],
): string | undefined {
  const flat = flattenTurnsToChatMessages(turns)
  if (flat.length === 0) return undefined

  const turnById = new Map(turns.map((t) => [t.turnId, t]))
  let takeNext = false

  for (let i = flat.length - 1; i >= 0; i--) {
    const msg = flat[i]!
    if (msg.role === 'user' && takeNext) {
      const turn = turnById.get(msg.turnId)
      const at = turn?.createdAt?.trim()
      return at || undefined
    }
    takeNext = true
  }
  return undefined
}

/** 由 turn 列表构建 Phase B 历史类宏字段 */
export function buildMacroHistoryFields(params: {
  /** 用于 lastMessageId / allChatRange 的索引 turn 集（尽量覆盖全对话尾部） */
  indexingTurns: TurnRecord[]
  /** 注入 history 的 turn 集（与 memory pipeline recentTurns 一致） */
  historyTurns: TurnRecord[]
  /** 再生 / swipe 时正在操作的 turn */
  activeTurn?: TurnRecord | null
  trimmedHistoryMessages?: TrimmedHistoryMessage[]
  characterNames?: string[]
}): MacroHistoryFields {
  const historyFlat = flattenTurnsToChatMessages(params.historyTurns)
  const allFlat = flattenTurnsToChatMessages(params.indexingTurns)

  if (historyFlat.length === 0 && !params.activeTurn) {
    const base = { ...EMPTY_HISTORY_FIELDS }
    base.firstIncludedMessageId = resolveFirstIncludedMessageId(
      allFlat,
      params.historyTurns,
      params.trimmedHistoryMessages,
    )
    const names = params.characterNames ?? []
    base.notChar = names.length > 1 ? names.slice(1).join(', ') : ''
    base.idleReferenceUserAt = findIdleReferenceUserAt(params.indexingTurns)
    return base
  }

  const lastUser = [...historyFlat].reverse().find((m) => m.role === 'user')
  const lastChar = [...historyFlat].reverse().find((m) => m.role === 'assistant')
  const lastMsg =
    historyFlat.length > 0 ? historyFlat[historyFlat.length - 1] : undefined

  const lastMessageId =
    allFlat.length > 0 ? String(allFlat.length - 1) : '0'

  const swipeTurn =
    params.activeTurn ??
    (params.historyTurns.length > 0
      ? params.historyTurns[params.historyTurns.length - 1]
      : null)
  const swipe = swipeFieldsForTurn(swipeTurn)

  const names = params.characterNames ?? []

  return {
    lastMessage: lastMsg?.content ?? '',
    lastUserMessage: lastUser?.content ?? '',
    lastCharMessage: lastChar?.content ?? '',
    lastMessageId,
    firstIncludedMessageId: resolveFirstIncludedMessageId(
      allFlat,
      params.historyTurns,
      params.trimmedHistoryMessages,
    ),
    allChatRange: `0-${lastMessageId}`,
    lastSwipeId: swipe.lastSwipeId,
    currentSwipeId: swipe.currentSwipeId,
    notChar: names.length > 1 ? names.slice(1).join(', ') : '',
    idleReferenceUserAt: findIdleReferenceUserAt(params.indexingTurns),
  }
}

export function applyMacroHistoryFields(
  target: MacroHistoryFields,
  patch: Partial<MacroHistoryFields>,
): MacroHistoryFields {
  return { ...target, ...patch }
}
