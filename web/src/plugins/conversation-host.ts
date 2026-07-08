import type { ChatTurnItem } from '@/types/chat-turn'
import {
  fetchConversationTurnsRange,
  persistTurnsBatchToServer,
} from '@/utils/chat-messages'
import {
  getActiveReceiveIndex,
  getActiveSegmentIndex,
  getSegmentReceives,
} from '@/utils/group-chat-turn'

export const CONVERSATION_BATCH_MAX_TURNS = 50

export interface ConversationTurnDto {
  turnOrdinal: number
  user: string
  receives: {
    id: string
    content: string
    reasoning?: string
    durationMs?: number
    estimatedTokens?: number
    completionTokens?: number
    model?: string
  }[]
  activeReceiveIndex: number
  /** 多 segment turn：PATCH 目标 segment（缺省 active） */
  segmentIndex?: number
}

export interface BatchPatchResult {
  ok: number
  failed: { turnOrdinal: number; error: string }[]
}

export interface ConversationReadOptions {
  range: { from: number; to: number }
}

export interface ConversationBatchContext {
  conversationId: string
  read(opts: ConversationReadOptions): Promise<ConversationTurnDto[]>
  patchTurns(dtos: ConversationTurnDto[]): Promise<BatchPatchResult>
}

export type ConversationHostErrorCode =
  | 'conversation_locked'
  | 'conversation_busy'
  | 'range_too_large'

export class ConversationHostError extends Error {
  readonly code: ConversationHostErrorCode

  constructor(code: ConversationHostErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'ConversationHostError'
    this.code = code
  }
}

export function turnToConversationDto(turn: ChatTurnItem): ConversationTurnDto {
  const segIdx = getActiveSegmentIndex(turn)
  const receives = getSegmentReceives(turn, segIdx)
  return {
    turnOrdinal: turn.turnOrdinal,
    user: turn.user,
    receives: receives.map((r) => ({
      id: r.id,
      content: r.content,
      ...(r.reasoning ? { reasoning: r.reasoning } : {}),
      ...(r.durationMs ? { durationMs: r.durationMs } : {}),
      ...(r.estimatedTokens ? { estimatedTokens: r.estimatedTokens } : {}),
      ...(r.completionTokens ? { completionTokens: r.completionTokens } : {}),
      ...(r.model ? { model: r.model } : {}),
    })),
    activeReceiveIndex: getActiveReceiveIndex(turn, segIdx),
  }
}

export function conversationDtoToTurnItem(dto: ConversationTurnDto): ChatTurnItem {
  const segIdx = dto.segmentIndex ?? 0
  const segments = Array.from({ length: segIdx + 1 }, (_, i) => ({
    id: '',
    speakerCharacterId: '',
    receives:
      i === segIdx
        ? dto.receives.map((r) => ({
            id: r.id,
            content: r.content,
            ...(r.reasoning ? { reasoning: r.reasoning } : {}),
            ...(r.durationMs ? { durationMs: r.durationMs } : {}),
            ...(r.estimatedTokens ? { estimatedTokens: r.estimatedTokens } : {}),
            ...(r.completionTokens ? { completionTokens: r.completionTokens } : {}),
            ...(r.model ? { model: r.model } : {}),
          }))
        : [],
    activeReceiveIndex: i === segIdx ? dto.activeReceiveIndex : 0,
  }))
  return {
    turnOrdinal: dto.turnOrdinal,
    user: dto.user,
    segments,
    activeSegmentIndex: segIdx,
  }
}

/** 仅保留 active receive；无变化时返回 null */
export function pruneInactiveSwipesDto(
  turn: ConversationTurnDto,
): ConversationTurnDto | null {
  if (turn.receives.length <= 1) return null
  const idx = Math.min(
    Math.max(0, turn.activeReceiveIndex),
    turn.receives.length - 1,
  )
  const kept = turn.receives[idx]
  if (!kept) return null
  return {
    ...turn,
    receives: [kept],
    activeReceiveIndex: 0,
  }
}

export async function readConversationTurnsRange(
  conversationId: string,
  range: { from: number; to: number },
): Promise<ConversationTurnDto[]> {
  const span = range.to - range.from + 1
  if (
    range.from < 0 ||
    range.to < range.from ||
    span > CONVERSATION_BATCH_MAX_TURNS
  ) {
    throw new ConversationHostError('range_too_large')
  }
  const turns = await fetchConversationTurnsRange(
    conversationId,
    range.from,
    range.to,
  )
  return turns.map(turnToConversationDto).sort((a, b) => a.turnOrdinal - b.turnOrdinal)
}

export async function patchConversationTurns(
  conversationId: string,
  dtos: ConversationTurnDto[],
): Promise<BatchPatchResult> {
  if (dtos.length === 0) return { ok: 0, failed: [] }
  if (dtos.length > CONVERSATION_BATCH_MAX_TURNS) {
    throw new ConversationHostError('range_too_large')
  }
  const turns = dtos.map(conversationDtoToTurnItem)
  return persistTurnsBatchToServer(conversationId, turns)
}
