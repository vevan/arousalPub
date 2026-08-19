import type { PromptTrigger } from '@/stores/prompts'
import type { ChatPersistPayload, ChatTurnItem, ReceiveItem } from '@/types/chat-turn'
import { isAbortError } from '@/utils/abort-error'
import {
  buildConversationChatRequestBody,
  cancelChatGenerationRequest,
  generateClientChatGenerationId,
  runChatRequest,
  type ConversationChatRequestPlugins,
} from '@/utils/chat-api'
import { allocateShortId } from '@/utils/short-id'
import type { Ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'
import type { useConnectionStore } from '@/stores/connection'
import type { AssistantReplyPersistedEvent } from './types.js'
import { makeReplyTraceId } from './types.js'
import { buildReceiveItem, collectUsedReceiveIds } from './turn-helpers.js'
import {
  resolveAssistantAfterPersist,
  mergeReceiveRuntimeFromPersist,
  shouldReloadMessagesAfterChat,
} from '@/utils/persist-display'

type ConnectionStore = ReturnType<typeof useConnectionStore>

export interface CompletionResult {
  content: string
  reasoning?: string
  persist?: ChatPersistPayload
  durationMs?: number
  estimatedTokens?: number
  completionTokens?: number
  traceId: string
}

export interface ChatCompletionDeps {
  conn: ConnectionStore
  getConversationId: () => string
  /** 会话生效 stream（来自激活/绑定预设，非设置页编辑表单） */
  getEffectiveStream: () => boolean
  /** 会话生效 model；用于就绪检查 */
  getEffectiveModel: () => string
  /** 会话生效预设是否已配置 Key */
  isEffectiveApiKeyConfigured: () => boolean
  t: ComposerTranslation
  turns: Ref<ChatTurnItem[]>
  streamingText: Ref<string>
  streamingReasoning: Ref<string>
  pendingSendEstimatedTokens: Ref<number | null>
  pendingReceiveCompletionTokens: Ref<number | null>
  pendingSendTurnOrdinal: Ref<number | null>
  pendingSendSegmentIndex: Ref<number | null>
  patchPendingSpeakerCharacterId: (
    ord: number,
    segmentIndex: number,
    speakerCharacterId: string,
  ) => void
  emitAssistantReplyPersisted: (event: AssistantReplyPersistedEvent) => void
  resolveDurationMs: () => number
}

let chatAbortController: AbortController | null = null

/** 本地 abort 原因（按 AbortController 区分，避免并发顶替串味） */
export type ChatAbortKind = 'user' | 'local' | 'supersede'

const abortKindByController = new WeakMap<AbortController, ChatAbortKind>()

/** 可供中止的服务端 generation（含断线 resume 期间） */
let cancelTarget: { conversationId: string; generationId: string } | null = null

export class ChatGenerationAbortError extends Error {
  readonly name = 'ChatGenerationAbortError'
  constructor(readonly kind: ChatAbortKind) {
    super('Aborted')
  }
}

export function isChatGenerationAbortError(
  e: unknown,
): e is ChatGenerationAbortError {
  return e instanceof ChatGenerationAbortError
}

export function hasRetainedChatGeneration(): boolean {
  return cancelTarget != null
}

export function clearRetainedChatGeneration(): void {
  cancelTarget = null
}

function setCancelTarget(conversationId: string, generationId: string): void {
  const cid = conversationId.trim()
  const gid = generationId.trim()
  if (!cid || !gid) return
  cancelTarget = { conversationId: cid, generationId: gid }
}

function abortLocalController(kind: ChatAbortKind): void {
  const c = chatAbortController
  if (!c) return
  abortKindByController.set(c, kind)
  c.abort()
}

function cancelActiveServerGeneration(): void {
  if (cancelTarget) {
    cancelChatGenerationRequest(
      cancelTarget.conversationId,
      cancelTarget.generationId,
    )
    cancelTarget = null
  }
}

/** 仅停止本地读流（不 cancel 服务端；用于回前台已落盘时收尾） */
export function abortLocalChatStream(): void {
  abortLocalController('local')
}

/** 用户中止：cancel 服务端上游 + 停本地读流 */
export function abortChatGeneration(): void {
  cancelActiveServerGeneration()
  abortLocalController('user')
}

export function createChatCompletionRunner(deps: ChatCompletionDeps) {
  function streamDeltaHandler(d: { text?: string; reasoning?: string }) {
    if (d.text) deps.streamingText.value += d.text
    if (d.reasoning) {
      deps.streamingReasoning.value =
        (deps.streamingReasoning.value || '') + d.reasoning
    }
  }

  async function requestChatCompletion(
    params: Parameters<typeof buildConversationChatRequestBody>[2],
    trace?: { traceId?: string; mode: 'send' | 'regenerate' },
  ): Promise<CompletionResult> {
    const mode = trace?.mode ?? 'send'
    const traceId = trace?.traceId ?? makeReplyTraceId(mode)

    cancelActiveServerGeneration()
    abortLocalController('supersede')
    const ownedController = new AbortController()
    chatAbortController = ownedController
    const signal = ownedController.signal
    const conversationId = deps.getConversationId()
    const expectStream = deps.getEffectiveStream()
    const clientGenerationId = expectStream
      ? generateClientChatGenerationId()
      : undefined
    if (clientGenerationId) {
      setCancelTarget(conversationId, clientGenerationId)
    }
    try {
      const result = await runChatRequest({
        conn: deps.conn,
        conversationId,
        params,
        expectStream,
        generationId: clientGenerationId,
        requestFailedMessage: (status) =>
          deps.t('chat.errors.requestFailedStatus', { status }),
        noStreamMessage: deps.t('chat.errors.noStream'),
        onStreamDelta: expectStream ? streamDeltaHandler : undefined,
        onPromptEstimatedTokens: (n) => {
          deps.pendingSendEstimatedTokens.value = n
        },
        onCompletionTokens: (n) => {
          deps.pendingReceiveCompletionTokens.value = n
        },
        onGenerationId: (gid) => {
          if (chatAbortController?.signal === signal) {
            setCancelTarget(conversationId, gid)
          }
        },
        onSpeakerCharacterId: (sid) => {
          const ord = deps.pendingSendTurnOrdinal.value
          if (ord == null) return
          const segIdx = deps.pendingSendSegmentIndex.value ?? 0
          deps.patchPendingSpeakerCharacterId(ord, segIdx, sid)
        },
        onPersist: (persist) => {
          if (persist.ok) {
            deps.emitAssistantReplyPersisted({
              mode,
              traceId,
              turnOrdinal: persist.turnOrdinal,
              receiveId: persist.receiveId,
              isFirstTurn: persist.isFirstTurn,
            })
          }
        },
        signal,
      })
      clearRetainedChatGeneration()
      return { ...result, traceId }
    } catch (e) {
      if (isAbortError(e) || isChatGenerationAbortError(e)) {
        const kind =
          (isChatGenerationAbortError(e) ? e.kind : null) ??
          abortKindByController.get(ownedController) ??
          'local'
        throw new ChatGenerationAbortError(kind)
      }
      throw e
    } finally {
      if (chatAbortController?.signal === signal) {
        chatAbortController = null
      }
    }
  }

  function parseCustomParamsOrThrow(): void {
    /* 会话对话不再使用编辑表单 customParams；无效 JSON 由服务端读预设时忽略 */
  }

  function customParamsErrorMessage(e: unknown): string {
    return e instanceof Error
      ? e.message
      : deps.t('chat.errors.invalidCustomJson')
  }

  function assertApiReady(): boolean {
    return (
      deps.isEffectiveApiKeyConfigured() &&
      deps.getEffectiveModel().trim().length > 0
    )
  }

  function resolveReceiveId(
    persist: ChatPersistPayload | undefined,
  ): string {
    const fromPersist = persist?.receiveId?.trim()
    if (fromPersist) return fromPersist
    return allocateShortId(collectUsedReceiveIds(deps.turns.value))
  }

  function makeReceiveFromResult(
    content: string,
    result: Pick<
      CompletionResult,
      'reasoning' | 'persist' | 'durationMs' | 'estimatedTokens' | 'completionTokens'
    >,
  ): ReceiveItem {
    const elapsed = result.durationMs ?? deps.resolveDurationMs()
    return mergeReceiveRuntimeFromPersist(
      buildReceiveItem(
        deps.conn.model,
        resolveReceiveId(result.persist),
        content,
        {
          reasoning: result.reasoning,
          durationMs: elapsed,
          estimatedTokens: result.estimatedTokens,
          completionTokens: result.completionTokens,
        },
      ),
      result.persist,
    )
  }

  async function runSend(params: {
    userText: string
    speakerQueue?: string[]
    speakerQueueDisplayNames?: string[]
    plugins?: ConversationChatRequestPlugins
  }): Promise<{
    receive: ReceiveItem
    traceId: string
    persist?: ChatPersistPayload
    shouldReload: boolean
  }> {
    parseCustomParamsOrThrow()
    const {
      content: assistantOut,
      reasoning: reasoningOut,
      persist,
      durationMs,
      estimatedTokens,
      completionTokens,
      traceId,
    } = await requestChatCompletion(
      {
        userText: params.userText,
        promptTrigger: 'normal',
        ...(params.speakerQueue?.length
          ? { speakerQueue: params.speakerQueue }
          : {}),
        ...(params.speakerQueueDisplayNames?.length
          ? { speakerQueueDisplayNames: params.speakerQueueDisplayNames }
          : {}),
        ...(params.plugins ? { plugins: params.plugins } : {}),
      },
      { mode: 'send' },
    )
    const { content, reasoning } = resolveAssistantAfterPersist(
      assistantOut,
      reasoningOut,
      persist,
    )
    const receive = makeReceiveFromResult(content, {
      reasoning,
      persist,
      durationMs,
      estimatedTokens,
      completionTokens,
    })
    return {
      receive,
      traceId,
      persist,
      shouldReload: shouldReloadMessagesAfterChat(assistantOut, persist),
    }
  }

  async function runRegenerate(params: {
    userText: string
    turnOrdinal: number
    segmentIndex?: number
    promptTrigger: PromptTrigger
    plugins?: ConversationChatRequestPlugins
  }): Promise<{
    receive: ReceiveItem
    traceId: string
    persist?: ChatPersistPayload
    shouldReload: boolean
    assistantOut: string
  }> {
    parseCustomParamsOrThrow()
    const {
      content: assistantOut,
      reasoning: reasoningOut,
      persist,
      durationMs,
      estimatedTokens,
      completionTokens,
      traceId,
    } = await requestChatCompletion(
      {
        userText: params.userText,
        promptTrigger: params.promptTrigger,
        historyBeforeTurnOrdinalExclusive: params.turnOrdinal,
        regenerateTurnOrdinal: params.turnOrdinal,
        ...(params.segmentIndex !== undefined
          ? { regenerateSegmentIndex: params.segmentIndex }
          : {}),
        ...(params.plugins ? { plugins: params.plugins } : {}),
      },
      { mode: 'regenerate' },
    )
    const { content, reasoning } = resolveAssistantAfterPersist(
      assistantOut,
      reasoningOut,
      persist,
    )
    const receive = makeReceiveFromResult(content, {
      reasoning,
      persist,
      durationMs,
      estimatedTokens,
      completionTokens,
    })
    return {
      receive,
      traceId,
      persist,
      assistantOut: content,
      shouldReload: shouldReloadMessagesAfterChat(assistantOut, persist),
    }
  }

  async function runGroupContinue(params: {
    turnOrdinal: number
    afterSegmentIndex: number
    speakerCharacterId: string
  }): Promise<{
    receive: ReceiveItem
    traceId: string
    persist?: ChatPersistPayload
    shouldReload: boolean
  }> {
    const {
      content: assistantOut,
      reasoning: reasoningOut,
      persist,
      durationMs,
      estimatedTokens,
      completionTokens,
      traceId,
    } = await requestChatCompletion(
      {
        userText: '',
        promptTrigger: 'groupContinue',
        groupContinue: {
          turnOrdinal: params.turnOrdinal,
          speakerCharacterId: params.speakerCharacterId,
          afterSegmentIndex: params.afterSegmentIndex,
        },
        speakerCharacterId: params.speakerCharacterId,
      },
      { mode: 'send' },
    )
    const { content, reasoning } = resolveAssistantAfterPersist(
      assistantOut,
      reasoningOut,
      persist,
    )
    const receive = makeReceiveFromResult(content, {
      reasoning,
      persist,
      durationMs,
      estimatedTokens,
      completionTokens,
    })
    return {
      receive,
      traceId,
      persist,
      shouldReload: shouldReloadMessagesAfterChat(assistantOut, persist),
    }
  }

  return {
    requestChatCompletion,
    parseCustomParamsOrThrow,
    customParamsErrorMessage,
    assertApiReady,
    runSend,
    runRegenerate,
    runGroupContinue,
    abortChatGeneration,
  }
}
