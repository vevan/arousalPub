import type { ChatTurnItem } from '@/types/chat-turn'
import {
  fetchConversationTurns,
  persistTurnToServer,
} from '@/utils/chat-messages'

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
  return {
    turnOrdinal: turn.turnOrdinal,
    user: turn.user,
    receives: turn.receives.map((r) => ({
      id: r.id,
      content: r.content,
      ...(r.reasoning ? { reasoning: r.reasoning } : {}),
      ...(r.durationMs ? { durationMs: r.durationMs } : {}),
      ...(r.estimatedTokens ? { estimatedTokens: r.estimatedTokens } : {}),
      ...(r.completionTokens ? { completionTokens: r.completionTokens } : {}),
      ...(r.model ? { model: r.model } : {}),
    })),
    activeReceiveIndex: turn.activeReceiveIndex,
  }
}

export function conversationDtoToTurnItem(dto: ConversationTurnDto): ChatTurnItem {
  return {
    turnOrdinal: dto.turnOrdinal,
    user: dto.user,
    receives: dto.receives.map((r) => ({
      id: r.id,
      content: r.content,
      ...(r.reasoning ? { reasoning: r.reasoning } : {}),
      ...(r.durationMs ? { durationMs: r.durationMs } : {}),
      ...(r.estimatedTokens ? { estimatedTokens: r.estimatedTokens } : {}),
      ...(r.completionTokens ? { completionTokens: r.completionTokens } : {}),
      ...(r.model ? { model: r.model } : {}),
    })),
    activeReceiveIndex: dto.activeReceiveIndex,
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
  const turns = await fetchConversationTurns(conversationId)
  return turns
    .filter(
      (t) => t.turnOrdinal >= range.from && t.turnOrdinal <= range.to,
    )
    .map(turnToConversationDto)
    .sort((a, b) => a.turnOrdinal - b.turnOrdinal)
}

export async function patchConversationTurns(
  conversationId: string,
  dtos: ConversationTurnDto[],
): Promise<BatchPatchResult> {
  if (dtos.length === 0) return { ok: 0, failed: [] }
  if (dtos.length > CONVERSATION_BATCH_MAX_TURNS) {
    throw new ConversationHostError('range_too_large')
  }
  let ok = 0
  const failed: { turnOrdinal: number; error: string }[] = []
  for (const dto of dtos) {
    try {
      const success = await persistTurnToServer(
        conversationId,
        conversationDtoToTurnItem(dto),
      )
      if (success) ok += 1
      else failed.push({ turnOrdinal: dto.turnOrdinal, error: 'patch_failed' })
    } catch (e) {
      failed.push({
        turnOrdinal: dto.turnOrdinal,
        error: e instanceof Error ? e.message : 'patch_failed',
      })
    }
  }
  return { ok, failed }
}
