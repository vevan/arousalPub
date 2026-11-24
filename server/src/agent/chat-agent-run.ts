import type { ChatMessage } from '../assemble-prompts.js'
import type { ChatPersistResult } from '../chat-persist-after-chat.js'
import { createChatUpstreamIdleAbort } from '../chat-upstream-stream.js'
import {
  fetchWithTimeout,
  UPSTREAM_FETCH_TIMEOUT_MS,
  UPSTREAM_STREAM_IDLE_TIMEOUT_MS,
} from '../fetch-with-timeout.js'
import { formatArousalPersistSseLine, formatArousalStreamErrorSseLine } from '../sse-assistant.js'
import { ApiErrorCodes } from '../api-error-codes.js'
import { runAgentLoop } from './agent-loop.js'
import { accumulateAssistantTurnFromSse } from './accumulate-assistant-from-sse.js'
import type { AssistantSseDelta } from './accumulate-assistant-from-sse.js'
import { extractAssistantModelTurn } from './extract-assistant-turn.js'
import type { AgentLoopProgressEvent } from './agent-loop.js'
import { prependAgentToolsSystemPad } from './agent-system-pad.js'
import {
  formatAssistantContentDeltaSse,
  formatAssistantReasoningSse,
  formatProgressReasoningChunk,
} from './agent-trace-format.js'
import {
  collectAgentToolDefinitions,
  dispatchAgentToolCall,
} from './plugin-tools-aggregate.js'
import { resolveRequiredCoreSearchToolNames } from './host-search-tools.js'
import type { AgentMessage, AgentLoopResult, AgentToolDefinition } from './types.js'

export function chatMessagesToAgentMessages(messages: ChatMessage[]): AgentMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))
}

export function agentMessagesToUpstream(
  messages: AgentMessage[],
): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: m.content ?? '',
      }
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: m.tool_calls,
      }
    }
    return {
      role: m.role,
      content: m.content ?? '',
    }
  })
}

export function formatArousalAgentSseLine(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ arousal: { agent: payload } })}\n\n`
}

export function formatAssistantContentSse(content: string): string {
  return (
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` +
    `data: [DONE]\n\n`
  )
}

export type ChatAgentUpstreamComplete = (input: {
  messages: AgentMessage[]
  tools: AgentToolDefinition[] | undefined
  signal: AbortSignal | undefined
  stepIndex: number
}) => Promise<import('./types.js').AssistantModelTurn>

export type ChatAgentUpstreamDeltaHandler = (d: AssistantSseDelta) => void

/** 出站 complete：可非流式或流式（流式时 onDelta 推 reasoning/content） */
export function createChatAgentUpstreamComplete(opts: {
  url: string
  apiKey: string
  /** 已含 model 等；本函数覆盖 messages/stream/tools */
  basePayload: Record<string, unknown>
  timeoutMs?: number
  /** true：上游 stream，经 onDelta 实时回调 */
  stream?: boolean
  onDelta?: ChatAgentUpstreamDeltaHandler
  /** 尚有必调工具未完成时首几轮用 required */
  shouldRequireTools?: (stepIndex: number) => boolean
  /**
   * 流式每步独立 idle（工具执行间隙不计入）。
   * 与主聊天 createChatUpstreamIdleAbort 对齐。
   */
  generationAbort?: AbortController | null
  streamIdleMs?: number
}): ChatAgentUpstreamComplete {
  const timeoutMs = opts.timeoutMs ?? UPSTREAM_FETCH_TIMEOUT_MS
  const useStream = opts.stream === true
  const idleMs = opts.streamIdleMs ?? UPSTREAM_STREAM_IDLE_TIMEOUT_MS
  return async ({ messages, tools, signal, stepIndex }) => {
    const payload: Record<string, unknown> = {
      ...opts.basePayload,
      messages: agentMessagesToUpstream(messages),
      stream: useStream,
    }
    if (tools && tools.length > 0) {
      payload.tools = tools
      payload.tool_choice =
        opts.shouldRequireTools?.(stepIndex) === true ? 'required' : 'auto'
    } else {
      delete payload.tools
      delete payload.tool_choice
    }
    const idle =
      useStream && opts.generationAbort
        ? createChatUpstreamIdleAbort(opts.generationAbort, idleMs)
        : null
    const fetchSignal = idle?.signal ?? signal
    try {
      const upstream = await fetchWithTimeout(
        opts.url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify(payload),
          ...(fetchSignal ? { signal: fetchSignal } : {}),
        },
        timeoutMs,
      )
      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => '')
        throw new Error(
          `upstream ${upstream.status}: ${errText.slice(0, 500) || 'error'}`,
        )
      }
      if (useStream) {
        if (!upstream.body) {
          throw new Error('upstream_missing_body')
        }
        return await accumulateAssistantTurnFromSse(upstream.body, {
          signal: fetchSignal,
          onDelta: (d) => {
            idle?.touch()
            opts.onDelta?.(d)
          },
        })
      }
      const text = await upstream.text()
      let data: unknown
      try {
        data = JSON.parse(text) as unknown
      } catch {
        throw new Error('upstream_non_json')
      }
      return extractAssistantModelTurn(data)
    } finally {
      idle?.dispose()
    }
  }
}

export interface RunChatAgentLoopParams {
  messages: ChatMessage[]
  basePayload: Record<string, unknown>
  url: string
  apiKey: string
  conversationId?: string
  userId?: string
  signal?: AbortSignal
  /** 流式上游逐步 idle；勿用整 loop 包一层（工具间隙会误杀） */
  generationAbort?: AbortController | null
  maxSteps?: number
  tools?: AgentToolDefinition[]
  complete?: ChatAgentUpstreamComplete
  streamUpstream?: boolean
  onUpstreamDelta?: ChatAgentUpstreamDeltaHandler
  searchContext?: import('./host-search-tools.js').AgentSearchContext
  onStep?: (info: {
    stepIndex: number
    toolNames: string[]
    finishReason: string
  }) => void
  onProgress?: (ev: AgentLoopProgressEvent) => void
  /** 多步/tool 期间续命 generation（防 idle sweep） */
  onActivity?: () => void
}

export type RunChatAgentLoopOutcome = AgentLoopResult & {
  toolsOffered: string[]
}

export async function runChatAgentLoop(
  params: RunChatAgentLoopParams,
): Promise<RunChatAgentLoopOutcome> {
  const tools =
    params.tools ?? (await collectAgentToolDefinitions(params.userId))
  const toolNames = tools.map((t) => t.function.name)
  const conversationId = params.conversationId?.trim() ?? ''
  const requiredToolNames = conversationId
    ? await resolveRequiredCoreSearchToolNames(conversationId)
    : []
  const calledRequired = new Set<string>()
  const complete =
    params.complete ??
    createChatAgentUpstreamComplete({
      url: params.url,
      apiKey: params.apiKey,
      basePayload: params.basePayload,
      stream: params.streamUpstream === true,
      onDelta: params.onUpstreamDelta,
      generationAbort: params.generationAbort,
      shouldRequireTools: () =>
        requiredToolNames.some((n) => !calledRequired.has(n)),
    })
  const seeded = prependAgentToolsSystemPad(
    chatMessagesToAgentMessages(params.messages),
    toolNames,
  )
  const result = await runAgentLoop({
    messages: seeded,
    tools: tools.length > 0 ? tools : undefined,
    maxSteps: params.maxSteps,
    signal: params.signal,
    onProgress: (ev) => {
      params.onActivity?.()
      params.onProgress?.(ev)
    },
    requiredToolNames,
    executeTool: conversationId
      ? async (name, argsJson, signal) => {
          params.onActivity?.()
          const out = await dispatchAgentToolCall({
            name,
            argsJson,
            conversationId,
            signal,
            userId: params.userId,
            searchContext: params.searchContext,
          })
          if (requiredToolNames.includes(name)) calledRequired.add(name)
          params.onActivity?.()
          return out
        }
      : undefined,
    complete: async (input) => {
      params.onActivity?.()
      const turn = await complete(input)
      for (const t of turn.toolCalls) {
        if (requiredToolNames.includes(t.function.name)) {
          calledRequired.add(t.function.name)
        }
      }
      params.onStep?.({
        stepIndex: input.stepIndex,
        toolNames: turn.toolCalls.map((t) => t.function.name),
        finishReason: turn.finishReason,
      })
      params.onActivity?.()
      return turn
    },
  })
  return { ...result, toolsOffered: toolNames }
}

/** 把进度事件写成 reasoning SSE，并累加全文（供落盘） */
export function emitAgentProgressAsReasoning(
  out: { write: (chunk: string) => unknown; destroyed?: boolean },
  ev: AgentLoopProgressEvent,
  acc: { text: string },
): void {
  const chunk = formatProgressReasoningChunk(ev)
  if (!chunk || out.destroyed) return
  acc.text += chunk
  out.write(formatAssistantReasoningSse(chunk))
  if (
    ev.type === 'tool_calls' ||
    ev.type === 'tool_result' ||
    ev.type === 'step_start' ||
    ev.type === 'final'
  ) {
    out.write(
      formatArousalAgentSseLine({
        phase: ev.type,
        stepIndex: ev.stepIndex,
        ...(ev.type === 'tool_calls'
          ? { toolNames: ev.tools.map((t) => t.name) }
          : ev.type === 'tool_result'
            ? {
                toolName: ev.tool.name,
                ok: ev.tool.ok !== false,
              }
            : ev.type === 'step_start'
              ? { toolsOffered: ev.toolsOffered }
              : {
                  finishReason: ev.finishReason,
                  usedTools: ev.usedTools,
                }),
      }),
    )
  }
}

/** 将 loop 结果写成客户端可消费的 SSE（末轮正文 + persist；步骤已在进度中写过） */
export function writeAgentLoopResultToSse(opts: {
  out: {
    write: (chunk: string) => unknown
    destroyed?: boolean
  }
  result: AgentLoopResult
  persist?: ChatPersistResult
  /** 正文已在上游流式下发时跳过，仅写 DONE + persist */
  skipContent?: boolean
  logWarn?: (obj: unknown, msg: string) => void
}): void {
  const { out, result, persist } = opts
  if (out.destroyed) return
  if (!result.ok) {
    const code =
      result.errorCode === 'cancelled'
        ? ApiErrorCodes.persist_cancelled_by_user
        : result.errorCode === 'max_steps'
          ? ApiErrorCodes.agent_max_steps
          : result.errorCode === 'required_tools_missing'
            ? ApiErrorCodes.agent_required_tools_missing
            : result.errorCode === 'upstream_error'
              ? ApiErrorCodes.upstream_api_error
              : ApiErrorCodes.agent_loop_failed
    out.write(
      formatArousalStreamErrorSseLine(
        code,
        result.errorDetail ?? result.errorCode,
      ),
    )
    return
  }
  if (result.content && !opts.skipContent) {
    out.write(formatAssistantContentSse(result.content))
  } else {
    out.write('data: [DONE]\n\n')
  }
  if (persist) {
    out.write(formatArousalPersistSseLine(persist))
  }
}

/** 供路由把上游 delta 写成客户端 SSE（reasoning 进思维链；content 进主泡） */
export function emitUpstreamDeltaToClient(
  out: { write: (chunk: string) => unknown; destroyed?: boolean },
  d: AssistantSseDelta,
  acc: { text: string; contentChars: number },
): void {
  if (out.destroyed) return
  if (d.reasoning) {
    acc.text += d.reasoning
    out.write(formatAssistantReasoningSse(d.reasoning))
  }
  if (d.text) {
    acc.contentChars += d.text.length
    out.write(formatAssistantContentDeltaSse(d.text))
  }
}
