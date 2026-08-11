import type { TurnReceive } from './chat-turn-types.js'

/** 单次 messages 区间读 / 批量 PATCH 上限 */
export const CONVERSATION_BATCH_MAX_TURNS = 50

/** UI 打开对话时默认尾部窗口（须 ≤ CONVERSATION_BATCH_MAX_TURNS） */
export const CONVERSATION_MESSAGES_DEFAULT_TAIL = 30

export interface TurnContentPatchInput {
  turnOrdinal: number
  userText: string
  receives: TurnReceive[]
  activeReceiveIndex: number
  /** 多 segment turn：更新指定 segment（regenerate/swipe/编辑） */
  segmentIndex?: number
  activeSegmentIndex?: number
}

export type ParseTurnPatchResult =
  | { ok: true; patch: TurnContentPatchInput }
  | { ok: false; error: string }
