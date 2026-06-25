import type { PromptTrigger } from '@/stores/prompts'
import type { ChatPersistPayload, ChatTurnItem, ReceiveItem } from '@/types/chat-turn'
import {
  buildConversationChatRequestBody,
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
  t: ComposerTranslation
  turns: Ref<ChatTurnItem[]>
  streamingText: Ref<string>
  streamingReasoning: Ref<string>
  pendingSendEstimatedTokens: Ref<number | null>
  pendingReceiveCompletionTokens: Ref<number | null>
  emitAssistantReplyPersisted: (event: AssistantReplyPersistedEvent) => void
  resolveDurationMs: () => number
}

let chatAbortController: AbortController | null = null

export function abortChatGeneration(): void {
  chatAbortController?.abort()
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

    chatAbortController?.abort()
    chatAbortController = new AbortController()
    const signal = chatAbortController.signal
    try {
      const result = await runChatRequest({
        conn: deps.conn,
        conversationId: deps.getConversationId(),
        params,
        requestFailedMessage: (status) =>
          deps.t('chat.errors.requestFailedStatus', { status }),
        noStreamMessage: deps.t('chat.errors.noStream'),
        onStreamDelta: deps.conn.stream ? streamDeltaHandler : undefined,
        onPromptEstimatedTokens: (n) => {
          deps.pendingSendEstimatedTokens.value = n
        },
        onCompletionTokens: (n) => {
          deps.pendingReceiveCompletionTokens.value = n
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
      return { ...result, traceId }
    } finally {
      if (chatAbortController?.signal === signal) {
        chatAbortController = null
      }
    }

  }

  function parseCustomParamsOrThrow(): void {
    if (deps.conn.customParamsJson.trim()) {
      deps.conn.parseCustomParams()
    }
  }

  function customParamsErrorMessage(e: unknown): string {
    return e instanceof Error
      ? e.message
      : deps.t('chat.errors.invalidCustomJson')
  }

  function assertApiReady(): boolean {
    return deps.conn.isApiKeyConfigured && deps.conn.model.trim().length > 0
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

  return {
    requestChatCompletion,
    parseCustomParamsOrThrow,
    customParamsErrorMessage,
    assertApiReady,
    runSend,
    runRegenerate,
    abortChatGeneration,
  }
}
