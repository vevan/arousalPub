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

function resolveFirstIncludedMessageId(
  allFlat: FlatHistoryMessage[],
  trimmed?: { role: 'user' | 'assistant'; content: string }[],
): string {
  if (!trimmed?.length) return '0'
  const first = trimmed[0]!
  const idx = allFlat.findIndex(
    (m) => m.role === first.role && m.content === first.content,
  )
  return String(idx >= 0 ? idx : 0)
}

/** 由 turn 列表构建 Phase B 历史类宏字段 */
export function buildMacroHistoryFields(params: {
  /** 用于 lastMessageId / allChatRange 的索引 turn 集（尽量覆盖全对话尾部） */
  indexingTurns: TurnRecord[]
  /** 注入 history 的 turn 集（与 memory pipeline recentTurns 一致） */
  historyTurns: TurnRecord[]
  /** 再生 / swipe 时正在操作的 turn */
  activeTurn?: TurnRecord | null
  trimmedHistoryMessages?: { role: 'user' | 'assistant'; content: string }[]
  characterNames?: string[]
}): MacroHistoryFields {
  const historyFlat = flattenTurnsToChatMessages(params.historyTurns)
  const allFlat = flattenTurnsToChatMessages(params.indexingTurns)

  if (historyFlat.length === 0 && !params.activeTurn) {
    const base = { ...EMPTY_HISTORY_FIELDS }
    base.firstIncludedMessageId = resolveFirstIncludedMessageId(
      allFlat,
      params.trimmedHistoryMessages,
    )
    const names = params.characterNames ?? []
    base.notChar = names.length > 1 ? names.slice(1).join(', ') : ''
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
      params.trimmedHistoryMessages,
    ),
    allChatRange: `0-${lastMessageId}`,
    lastSwipeId: swipe.lastSwipeId,
    currentSwipeId: swipe.currentSwipeId,
    notChar: names.length > 1 ? names.slice(1).join(', ') : '',
  }
}

export function applyMacroHistoryFields(
  target: MacroHistoryFields,
  patch: Partial<MacroHistoryFields>,
): MacroHistoryFields {
  return { ...target, ...patch }
}
