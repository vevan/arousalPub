import { ApiErrorCodes } from './api-error-codes.js'
import type { ChatMessage } from './assemble-prompts.js'
import { readChunkContainingOrdinal } from './chunk-chain.js'
import { estimateTokens } from './token-count.js'
import { allocateShortId } from './short-id.js'
import {
  appendConversationTurn,
  buildReceiveRuntime,
  collectChunkEntityIds,
  readConversationIndex,
  readTailChunk,
  saveFirstTurn,
  updateTurnContentInTailChunk,
  type TurnReceive,
} from './chat-storage.js'
import type { ResolvedFeatureAudit } from './feature-binding-resolve.js'
import type { TurnPluginEntry } from './plugin-types.js'
import type {
  AssemblyAudit,
  CallAuditEntry,
  ChatAuditSnapshotInput,
} from './chat-audit-types.js'
import { isAuditDebugWriteEnabled } from './chat-audit-file.js'

export interface ChatPersistResult {
  ok: boolean
  error?: string
  turnOrdinal?: number
  receiveId?: string
  isFirstTurn?: boolean
}

/** 出站 token：上游 usage.prompt_tokens，缺省用组装估算 */
function resolveAuditPromptTokens(params: {
  promptTokens?: number
  estimatedTokens?: number
  assemblyAudit?: AssemblyAudit
}): number | undefined {
  if (
    typeof params.promptTokens === 'number' &&
    Number.isFinite(params.promptTokens) &&
    params.promptTokens > 0
  ) {
    return Math.round(params.promptTokens)
  }
  if (
    typeof params.estimatedTokens === 'number' &&
    Number.isFinite(params.estimatedTokens) &&
    params.estimatedTokens > 0
  ) {
    return Math.round(params.estimatedTokens)
  }
  const asm = params.assemblyAudit?.estimatedTokens
  if (typeof asm === 'number' && Number.isFinite(asm) && asm > 0) {
    return Math.round(asm)
  }
  return undefined
}

function auditSnapshotFromPersist(
  idx: Awaited<ReturnType<typeof readConversationIndex>>,
  messages: ChatMessage[],
  assemblyAudit?: AssemblyAudit,
  assemblyEmbeddingCalls?: CallAuditEntry[],
  chatCall?: CallAuditEntry,
): ChatAuditSnapshotInput | undefined {
  if (!isAuditDebugWriteEnabled(idx)) return undefined
  const calls: CallAuditEntry[] = [
    ...(assemblyEmbeddingCalls ?? []),
    ...(chatCall ? [chatCall] : []),
  ]
  return {
    messages,
    ...(assemblyAudit ? { assembly: assemblyAudit } : {}),
    ...(calls.length > 0 ? { calls } : {}),
  }
}

function receiveRuntime(
  model?: string,
  durationMs?: number,
  estimatedTokens?: number,
  completionTokens?: number,
  resolvedFeature?: ResolvedFeatureAudit,
): Record<string, unknown> | undefined {
  return buildReceiveRuntime({
    model,
    durationMs,
    estimatedTokens,
    completionTokens,
    resolvedFeature,
  })
}

function resolveCompletionTokens(
  upstream: number | undefined,
  assistantContent: string,
  assistantReasoning: string | undefined,
  model?: string,
): number | undefined {
  if (typeof upstream === 'number' && upstream > 0) {
    return Math.round(upstream)
  }
  const corpus = [
    assistantContent.trim(),
    assistantReasoning?.trim() ?? '',
  ]
    .filter((s) => s.length > 0)
    .join('\n\n')
  if (!corpus) return undefined
  const n = estimateTokens(corpus, { model })
  return n > 0 ? n : undefined
}

/**
 * 上游成功且 assistant 有正文后：首条 / 追加轮 / 再生追加 receive；
 * 审计快照在落盘成功后写入（由 saveFirstTurn / append / update 内部处理）。
 */
export async function persistTurnAfterModelReply(params: {
  conversationId: string
  userText: string
  assistantContent: string
  assistantReasoning?: string
  model?: string
  durationMs?: number
  estimatedTokens?: number
  completionTokens?: number
  promptTokens?: number
  resolvedFeature?: ResolvedFeatureAudit
  assembledMessages: ChatMessage[]
  assemblyAudit?: AssemblyAudit
  assemblyEmbeddingCalls?: CallAuditEntry[]
  /** 再生：向该轮追加 receive，不新开 turn */
  regenerateTurnOrdinal?: number | null
  turnPluginEntries?: TurnPluginEntry[]
}): Promise<ChatPersistResult> {
  const conversationId = params.conversationId.trim()
  const userText = params.userText.trim()
  const assistantContent = params.assistantContent.trim()
  if (!conversationId || !userText) {
    return { ok: false, error: ApiErrorCodes.missing_conversation_or_user_text }
  }
  if (!assistantContent) {
    return { ok: false, error: ApiErrorCodes.assistant_content_empty_no_persist }
  }

  const idx = await readConversationIndex(conversationId)
  if (!idx) {
    return { ok: false, error: ApiErrorCodes.conversation_not_found }
  }

  const model =
    typeof params.model === 'string' && params.model.trim()
      ? params.model.trim()
      : undefined

  const reasoning =
    typeof params.assistantReasoning === 'string' &&
    params.assistantReasoning.trim()
      ? params.assistantReasoning.trim()
      : undefined
  const completionTokens = resolveCompletionTokens(
    params.completionTokens,
    assistantContent,
    reasoning,
    model,
  )

  const promptTokensForAudit = resolveAuditPromptTokens(params)
  const chatUsage =
    promptTokensForAudit !== undefined || completionTokens !== undefined
      ? {
          ...(promptTokensForAudit !== undefined
            ? { promptTokens: promptTokensForAudit }
            : {}),
          ...(completionTokens !== undefined
            ? { completionTokens }
            : {}),
        }
      : undefined

  const chatCall: CallAuditEntry | undefined =
    model || params.durationMs || params.resolvedFeature || chatUsage
      ? {
          kind: 'chat',
          ...(params.resolvedFeature?.apiConfigId
            ? { apiConfigId: params.resolvedFeature.apiConfigId }
            : {}),
          ...(model ? { model } : {}),
          ...(typeof params.durationMs === 'number' && params.durationMs > 0
            ? { latencyMs: Math.round(params.durationMs) }
            : {}),
          ...(chatUsage ? { usage: chatUsage } : {}),
        }
      : undefined

  const auditSnapshot = auditSnapshotFromPersist(
    idx,
    params.assembledMessages,
    params.assemblyAudit,
    params.assemblyEmbeddingCalls,
    chatCall,
  )
  const runtime = receiveRuntime(
    model,
    params.durationMs,
    params.estimatedTokens,
    completionTokens,
    params.resolvedFeature,
  )

  const regenOrd = params.regenerateTurnOrdinal
  if (
    typeof regenOrd === 'number' &&
    Number.isInteger(regenOrd) &&
    regenOrd >= 0
  ) {
    const located = await readChunkContainingOrdinal(conversationId, regenOrd)
    if (located) {
      const { chunk } = located
      const turn = chunk.turns.find((t) => t.turnOrdinal === regenOrd)
      if (!turn) {
        return { ok: false, error: ApiErrorCodes.regenerate_turn_not_found }
      }
      const used = collectChunkEntityIds(chunk)
      const receiveId = allocateShortId(used)
      const receives: TurnReceive[] = [
        ...(turn.receives ?? []).map((r) => {
          const rec: TurnReceive = {
            id:
              typeof r.id === 'string' && r.id.trim()
                ? r.id.trim()
                : allocateShortId(used),
            content: typeof r.content === 'string' ? r.content : '',
          }
          if (typeof r.reasoning === 'string' && r.reasoning.length > 0) {
            rec.reasoning = r.reasoning
          }
          if (r.runtime && typeof r.runtime === 'object') {
            rec.runtime = r.runtime
          }
          return rec
        }),
        {
          id: receiveId,
          content: assistantContent,
          ...(reasoning ? { reasoning } : {}),
          ...(runtime ? { runtime } : {}),
        },
      ]
      const activeReceiveIndex = receives.length - 1
      const ok = await updateTurnContentInTailChunk(
        conversationId,
        regenOrd,
        userText,
        receives,
        activeReceiveIndex,
        auditSnapshot,
        params.turnPluginEntries,
      )
      if (!ok) {
        return { ok: false, error: ApiErrorCodes.turn_update_failed }
      }
      return {
        ok: true,
        turnOrdinal: regenOrd,
        receiveId,
        isFirstTurn: false,
      }
    }

    /** 首轮空回复未落盘时，再生按首次/追加写入，避免「未找到再生轮次」 */
    if (!idx.headChunkFile) {
      if (regenOrd !== 0) {
        return { ok: false, error: ApiErrorCodes.regenerate_turn_not_found }
      }
      const saved = await saveFirstTurn({
        conversationId,
        userText,
        assistantText: assistantContent,
        reasoning,
        model,
        durationMs: params.durationMs,
        estimatedTokens: params.estimatedTokens,
        completionTokens,
        resolvedFeature: params.resolvedFeature,
        auditSnapshot,
        turnPluginEntries: params.turnPluginEntries,
      })
      if (!saved) {
        return { ok: false, error: ApiErrorCodes.first_turn_persist_maybe_exists }
      }
      const rec = saved.chunk.turns[0]?.receives[0]
      return {
        ok: true,
        turnOrdinal: 0,
        receiveId: typeof rec?.id === 'string' ? rec.id : undefined,
        isFirstTurn: true,
      }
    }

    const tailChunk = await readTailChunk(conversationId)
    const used = tailChunk ? collectChunkEntityIds(tailChunk) : new Set<string>()
    const receiveId = allocateShortId(used)
    const receives: TurnReceive[] = [
      {
        id: receiveId,
        content: assistantContent,
        ...(reasoning ? { reasoning } : {}),
        ...(runtime ? { runtime } : {}),
      },
    ]
    const ok = await appendConversationTurn({
      conversationId,
      userText,
      receives,
      activeReceiveIndex: 0,
      auditSnapshot,
      turnPluginEntries: params.turnPluginEntries,
    })
    if (!ok) {
      return { ok: false, error: ApiErrorCodes.append_turn_failed }
    }
    const chunk = await readTailChunk(conversationId)
    const last = chunk?.turns[chunk.turns.length - 1]
    return {
      ok: true,
      turnOrdinal: last?.turnOrdinal ?? regenOrd,
      receiveId,
      isFirstTurn: false,
    }
  }

  if (!idx.headChunkFile) {
    const saved = await saveFirstTurn({
      conversationId,
      userText,
      assistantText: assistantContent,
      reasoning,
      model,
      durationMs: params.durationMs,
      estimatedTokens: params.estimatedTokens,
      completionTokens,
      resolvedFeature: params.resolvedFeature,
      auditSnapshot,
      turnPluginEntries: params.turnPluginEntries,
    })
    if (!saved) {
      return { ok: false, error: ApiErrorCodes.first_turn_persist_maybe_exists }
    }
    const rec = saved.chunk.turns[0]?.receives[0]
    return {
      ok: true,
      turnOrdinal: 0,
      receiveId: typeof rec?.id === 'string' ? rec.id : undefined,
      isFirstTurn: true,
    }
  }

  const tailChunk = await readTailChunk(conversationId)
  const used = tailChunk ? collectChunkEntityIds(tailChunk) : new Set<string>()
  const receiveId = allocateShortId(used)
  const receives: TurnReceive[] = [
    {
      id: receiveId,
      content: assistantContent,
      ...(reasoning ? { reasoning } : {}),
      ...(runtime ? { runtime } : {}),
    },
  ]
  const ok = await appendConversationTurn({
    conversationId,
    userText,
    receives,
    activeReceiveIndex: 0,
    auditSnapshot,
    turnPluginEntries: params.turnPluginEntries,
  })
  if (!ok) {
    return { ok: false, error: ApiErrorCodes.append_turn_failed }
  }
  const chunk = await readTailChunk(conversationId)
  const last = chunk?.turns[chunk.turns.length - 1]
  return {
    ok: true,
    turnOrdinal: last?.turnOrdinal,
    receiveId,
    isFirstTurn: false,
  }
}
