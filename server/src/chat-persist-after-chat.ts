import { ApiErrorCodes } from './api-error-codes.js'
import type { ChatMessage } from './assemble-prompts.js'
import { readChunkContainingOrdinal, readConversationActiveBranchPath, readTailChunkAt } from './chunk-chain.js'
import { estimateTokens } from './token-count.js'
import { allocateShortId } from './short-id.js'
import {
  appendConversationTurn,
  buildReceiveRuntime,
  collectChunkEntityIds,
  readConversationIndex,
  readConversationPluginSettings,
  saveFirstTurn,
  updateTurnContentInTailChunk,
  type TurnReceive,
} from './chat-storage.js'
import type { ResolvedFeatureAudit } from './feature-binding-resolve.js'
import {
  mergeTurnPluginEntries,
  resolveTurnPluginEntriesFromAssistant,
} from './plugin-host.js'
import { attachReceiveIdToTurnPluginEntries } from './turn-plugin-utils.js'
import type { ChatPluginsBody, TurnPluginEntry } from './plugin-types.js'
import type {
  AssemblyAudit,
  CallAuditEntry,
  ChatAuditSnapshotInput,
  PerformanceAudit,
  PersistTimingMs,
} from './chat-audit-types.js'
import { isAuditDebugWriteEnabled } from './chat-audit-file.js'
import {
  loadAndApplyRegexPersistForTurn,
  resolvePersistTurnOrdinal,
  type PersistRegexFields,
} from './regex-persist.js'
import {
  attachRetroToPersistResult,
  runRetroPersistAfterTurnPersist,
  type RetroPersistRunResult,
  type RetroPersistStatus,
  type RetroPersistTurnPayload,
} from './regex-persist-retro.js'
import { resolveConversationTailOrdinal } from './regex-persist-patch.js'

export type { RetroPersistStatus, RetroPersistTurnPayload } from './regex-persist-retro.js'

export interface ChatPersistResult {
  ok: boolean
  error?: string
  turnOrdinal?: number
  turnId?: string
  receiveId?: string
  isFirstTurn?: boolean
  /** persist 阶段 regex 后的 user 正文（落盘内容） */
  finalUserText?: string
  /** persist 阶段 regex 后的 assistant 正文（落盘内容） */
  finalAssistantContent?: string
  finalAssistantReasoning?: string
  /** skip 窗口回溯 persist 改动的历史轮 */
  retro?: RetroPersistTurnPayload[]
  retroStatus?: RetroPersistStatus
  /** 落盘轮次的 plugins[] 快照，供前端增量 patch、避免全量 reload */
  plugins?: unknown[]
  /** 落盘时 trace-keeper trackerEpoch */
  trackerEpoch?: number
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
  performance?: PerformanceAudit,
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
    ...(performance ? { performance } : {}),
  }
}

async function applyPersistRegexFieldsTimed(
  userText: string,
  assistantContent: string,
  assistantReasoning: string | undefined,
  turnOrdinal: number,
  conversationId: string,
  persistMs?: PersistTimingMs,
): Promise<PersistRegexFields> {
  const startedAt = persistMs ? performance.now() : 0
  const fields = await applyPersistRegexFields(
    userText,
    assistantContent,
    assistantReasoning,
    turnOrdinal,
    conversationId,
  )
  if (persistMs) {
    persistMs.regex = Math.round(performance.now() - startedAt)
  }
  return fields
}

function performanceWithPersistRegex(
  base: PerformanceAudit | undefined,
): PerformanceAudit | undefined {
  if (!base) return undefined
  return { ...base, persistMs: {} }
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

function trackerEpochFromConvIndex(
  idx: Awaited<ReturnType<typeof readConversationIndex>>,
): number {
  if (!idx) return 0
  const tk = readConversationPluginSettings(idx, 'trace-keeper')
  const n = tk.trackerEpoch
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

function turnPluginsFromChunk(
  chunk: { turns: { turnOrdinal: number; plugins?: unknown[] }[] } | null | undefined,
  turnOrdinal: number,
): unknown[] | undefined {
  if (!chunk) return undefined
  const turn = chunk.turns.find((t) => t.turnOrdinal === turnOrdinal)
  if (!turn || !Array.isArray(turn.plugins)) return undefined
  return turn.plugins
}

function okPersistResult(
  base: {
    turnOrdinal?: number
    turnId?: string
    receiveId?: string
    isFirstTurn?: boolean
  },
  fields: PersistRegexFields,
  plugins?: unknown[],
  trackerEpoch?: number,
): ChatPersistResult {
  return {
    ok: true,
    ...base,
    finalUserText: fields.userText,
    finalAssistantContent: fields.assistantContent,
    ...(fields.assistantReasoning !== undefined
      ? { finalAssistantReasoning: fields.assistantReasoning }
      : {}),
    ...(plugins !== undefined ? { plugins } : {}),
    ...(typeof trackerEpoch === 'number' ? { trackerEpoch } : {}),
  }
}

async function applyPersistRegexFields(
  userText: string,
  assistantContent: string,
  assistantReasoning: string | undefined,
  turnOrdinal: number,
  conversationId: string,
): Promise<PersistRegexFields> {
  return loadAndApplyRegexPersistForTurn(
    {
      userText,
      assistantContent,
      assistantReasoning,
    },
    turnOrdinal,
    conversationId,
  )
}

async function finishPersistResult(
  conversationId: string,
  base: {
    turnOrdinal?: number
    turnId?: string
    receiveId?: string
    isFirstTurn?: boolean
  },
  fields: PersistRegexFields,
  retroOpts: { newTailOrdinal: number; includeNewRetro: boolean } | null,
  plugins?: unknown[],
  trackerEpoch?: number,
): Promise<ChatPersistResult> {
  const result = okPersistResult(base, fields, plugins, trackerEpoch)
  if (!retroOpts) return result
  let retroRun: RetroPersistRunResult | null = null
  try {
    retroRun = await runRetroPersistAfterTurnPersist(conversationId, retroOpts)
  } catch (e) {
    console.warn('[persist] retro persist failed', conversationId, e)
  }
  return attachRetroToPersistResult(result, retroRun)
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
  chatPlugins?: ChatPluginsBody | null
  /** debug 审计：组装/上游性能（persist 阶段会补全 persistMs） */
  performanceAudit?: PerformanceAudit
}): Promise<ChatPersistResult> {
  const conversationId = params.conversationId.trim()
  const rawUserText = params.userText.trim()
  const rawAssistantContent = params.assistantContent.trim()
  if (!conversationId || !rawUserText) {
    return { ok: false, error: ApiErrorCodes.missing_conversation_or_user_text }
  }
  if (!rawAssistantContent) {
    return { ok: false, error: ApiErrorCodes.assistant_content_empty_no_persist }
  }

  const assistantPluginEntries = await resolveTurnPluginEntriesFromAssistant(
    rawAssistantContent,
    {
      plugins: params.chatPlugins,
      conversationId,
    },
  )
  const turnPluginEntries = mergeTurnPluginEntries(
    params.turnPluginEntries ?? [],
    assistantPluginEntries,
  )

  const idx = await readConversationIndex(conversationId)
  if (!idx) {
    return { ok: false, error: ApiErrorCodes.conversation_not_found }
  }
  const activeBranchPath = await readConversationActiveBranchPath(conversationId)
  const trackerEpoch = trackerEpochFromConvIndex(idx)

  const model =
    typeof params.model === 'string' && params.model.trim()
      ? params.model.trim()
      : undefined

  const rawReasoning =
    typeof params.assistantReasoning === 'string' &&
    params.assistantReasoning.trim()
      ? params.assistantReasoning.trim()
      : undefined

  const regenOrd = params.regenerateTurnOrdinal
  const perfBase = performanceWithPersistRegex(params.performanceAudit)
  const persistMs = perfBase?.persistMs

  if (
    typeof regenOrd === 'number' &&
    Number.isInteger(regenOrd) &&
    regenOrd >= 0
  ) {
    const fields = await applyPersistRegexFieldsTimed(
      rawUserText,
      rawAssistantContent,
      rawReasoning,
      regenOrd,
      conversationId,
      persistMs,
    )
    const userText = fields.userText
    const assistantContent = fields.assistantContent
    const reasoning = fields.assistantReasoning
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
      perfBase,
    )
    const runtime = receiveRuntime(
      model,
      params.durationMs,
      params.estimatedTokens,
      completionTokens,
      params.resolvedFeature,
    )

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
        attachReceiveIdToTurnPluginEntries(turnPluginEntries, receiveId),
      )
      if (!ok) {
        return { ok: false, error: ApiErrorCodes.turn_update_failed }
      }
      const afterLocated = await readChunkContainingOrdinal(conversationId, regenOrd)
      return finishPersistResult(
        conversationId,
        {
          turnOrdinal: regenOrd,
          turnId: turn.turnId,
          receiveId,
          isFirstTurn: false,
        },
        fields,
        {
          newTailOrdinal: await resolveConversationTailOrdinal(conversationId),
          includeNewRetro: false,
        },
        turnPluginsFromChunk(afterLocated?.chunk, regenOrd),
        trackerEpoch,
      )
    }

    /** 首轮空回复未落盘时，再生按首次/追加写入，避免「未找到再生轮次」 */
    if (!idx.headChunkFile && !activeBranchPath) {
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
        turnPluginEntries: turnPluginEntries.length > 0 ? turnPluginEntries : undefined,
      })
      if (!saved) {
        return { ok: false, error: ApiErrorCodes.first_turn_persist_maybe_exists }
      }
      const firstTurn = saved.chunk.turns[0]
      const rec = firstTurn?.receives[0]
      return finishPersistResult(
        conversationId,
        {
          turnOrdinal: 0,
          turnId: firstTurn?.turnId,
          receiveId: typeof rec?.id === 'string' ? rec.id : undefined,
          isFirstTurn: true,
        },
        fields,
        { newTailOrdinal: 0, includeNewRetro: true },
        turnPluginsFromChunk(saved.chunk, 0),
        trackerEpoch,
      )
    }

    const tailChunk = await readTailChunkAt(conversationId, activeBranchPath)
    const used = tailChunk ? collectChunkEntityIds(tailChunk) : new Set<string>()
    const receiveId = allocateShortId(used)
    const appendOrdinal =
      tailChunk?.turns[tailChunk.turns.length - 1]?.turnOrdinal !== undefined
        ? tailChunk.turns[tailChunk.turns.length - 1]!.turnOrdinal + 1
        : regenOrd
    const appendFields = await applyPersistRegexFieldsTimed(
      rawUserText,
      rawAssistantContent,
      rawReasoning,
      appendOrdinal,
      conversationId,
      persistMs,
    )
    const receives: TurnReceive[] = [
      {
        id: receiveId,
        content: appendFields.assistantContent,
        ...(appendFields.assistantReasoning
          ? { reasoning: appendFields.assistantReasoning }
          : {}),
        ...(runtime ? { runtime } : {}),
      },
    ]
    const ok = await appendConversationTurn({
      conversationId,
      userText: appendFields.userText,
      receives,
      activeReceiveIndex: 0,
      auditSnapshot,
      turnPluginEntries: turnPluginEntries.length > 0 ? turnPluginEntries : undefined,
    })
    if (!ok) {
      return { ok: false, error: ApiErrorCodes.append_turn_failed }
    }
    const chunk = await readTailChunkAt(conversationId, activeBranchPath)
    const last = chunk?.turns[chunk.turns.length - 1]
    const appendTurnOrdinal = last?.turnOrdinal ?? appendOrdinal
    return finishPersistResult(
      conversationId,
      {
        turnOrdinal: appendTurnOrdinal,
        turnId: last?.turnId,
        receiveId,
        isFirstTurn: false,
      },
      appendFields,
      {
        newTailOrdinal: appendTurnOrdinal,
        includeNewRetro: true,
      },
      turnPluginsFromChunk(chunk, appendTurnOrdinal),
      trackerEpoch,
    )
  }

  const turnOrdinal = await resolvePersistTurnOrdinal({
    conversationId,
    hasHeadChunk: Boolean(idx.headChunkFile),
    regenerateTurnOrdinal: null,
  })
  const fields = await applyPersistRegexFieldsTimed(
    rawUserText,
    rawAssistantContent,
    rawReasoning,
    turnOrdinal,
    conversationId,
    persistMs,
  )
  const userText = fields.userText
  const assistantContent = fields.assistantContent
  const reasoning = fields.assistantReasoning
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
    perfBase,
  )
  const runtime = receiveRuntime(
    model,
    params.durationMs,
    params.estimatedTokens,
    completionTokens,
    params.resolvedFeature,
  )

  if (!idx.headChunkFile && !activeBranchPath) {
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
      turnPluginEntries: turnPluginEntries.length > 0 ? turnPluginEntries : undefined,
    })
    if (!saved) {
      return { ok: false, error: ApiErrorCodes.first_turn_persist_maybe_exists }
    }
    const firstTurn = saved.chunk.turns[0]
    const rec = firstTurn?.receives[0]
    return finishPersistResult(
      conversationId,
      {
        turnOrdinal: 0,
        turnId: firstTurn?.turnId,
        receiveId: typeof rec?.id === 'string' ? rec.id : undefined,
        isFirstTurn: true,
      },
      fields,
      { newTailOrdinal: 0, includeNewRetro: true },
      turnPluginsFromChunk(saved.chunk, 0),
      trackerEpoch,
    )
  }

  const tailChunk = await readTailChunkAt(conversationId, activeBranchPath)
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
    turnPluginEntries: turnPluginEntries.length > 0 ? turnPluginEntries : undefined,
  })
  if (!ok) {
    return { ok: false, error: ApiErrorCodes.append_turn_failed }
  }
  const chunk = await readTailChunkAt(conversationId, activeBranchPath)
  const last = chunk?.turns[chunk.turns.length - 1]
  const persistedOrdinal = last?.turnOrdinal ?? turnOrdinal
  return finishPersistResult(
    conversationId,
    {
      turnOrdinal: persistedOrdinal,
      turnId: last?.turnId,
      receiveId,
      isFirstTurn: false,
    },
    fields,
    {
      newTailOrdinal: persistedOrdinal,
      includeNewRetro: true,
    },
    turnPluginsFromChunk(chunk, persistedOrdinal),
    trackerEpoch,
  )
}
