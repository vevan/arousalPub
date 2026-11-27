import { randomUUID } from 'node:crypto'
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
import {
  formatAssistantContentDeltaSse,
  formatAssistantReasoningSse,
  formatProgressReasoningChunk,
} from './agent-trace-format.js'
import { policyWriteToolNames } from './agent-pipeline-policy.js'
import {
  createAgentPipelineRuntime,
  type AgentPipelineRuntime,
} from './agent-pipeline-runtime.js'
import { createAgentGraphRuntime } from './agent-graph-runtime.js'
import {
  prependAgentToolsSystemPadFromGraph,
  prependAgentToolsSystemPadFromPolicy,
} from './agent-system-pad.js'
import {
  collectAgentToolDefinitions,
  collectAgentToolMaxCallsPerTurn,
  collectPluginToolDecls,
  dispatchAgentNodeCall,
  dispatchAgentToolCall,
} from './plugin-tools-aggregate.js'
import {
  isCoreAgentToolName,
  listCoreAgentToolDefinitions,
  resolveRequiredCoreSearchToolNames,
} from './host-search-tools.js'
import { resolveToolMaxCallsPerTurn } from './agent-tool-budget.js'
import { readAgentSettingsDocument } from './agent-settings-file.js'
import { needsAgentGraphRuntime, validateAgentGraph } from './agent-graph.js'
import { buildPolicyFromEffectiveSteps } from './agent-effective.js'
import { collectAgentToolCatalog, catalogPhaseByTool } from './agent-tools-catalog.js'
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
  toolChoice?: 'auto' | 'required' | 'none'
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
  return async ({ messages, tools, toolChoice, signal }) => {
    const payload: Record<string, unknown> = {
      ...opts.basePayload,
      messages: agentMessagesToUpstream(messages),
      stream: useStream,
    }
    if (tools && tools.length > 0 && toolChoice !== 'none') {
      payload.tools = tools
      payload.tool_choice = toolChoice === 'required' ? 'required' : 'auto'
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
  /**
   * 再生/滑动目标 turn；插件可用其把 live staging 基线钉在「本 turn 之前」，
   * 避免同 turn 其它 receive 的 staging 串味。
   */
  regenerateTurnOrdinal?: number | null
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
  const requiredSearchToolNames = conversationId
    ? await resolveRequiredCoreSearchToolNames(conversationId)
    : []

  // 注入 tools 的测试路径不加载插件目录（无用户上下文）
  const maxCallsByTool = params.tools
    ? new Map(
        params.tools.map((t) => {
          const name = t.function.name
          const phase = isCoreAgentToolName(name) ? ('read' as const) : undefined
          return [
            name,
            resolveToolMaxCallsPerTurn({ name, phase }),
          ] as const
        }),
      )
    : await collectAgentToolMaxCallsPerTurn(params.userId)
  const pluginDecls = params.tools
    ? []
    : await collectPluginToolDecls(params.userId)

  const pipelineTools = params.tools?.length
    ? params.tools.map((t) => {
        const name = t.function.name
        const phase = isCoreAgentToolName(name)
          ? ('read' as const)
          : undefined
        return {
          name,
          phase,
          maxCallsPerTurn:
            maxCallsByTool.get(name) ??
            resolveToolMaxCallsPerTurn({ name, phase }),
        }
      })
    : [
        ...listCoreAgentToolDefinitions().map((d) => ({
          name: d.function.name,
          phase: 'read' as const,
          maxCallsPerTurn:
            maxCallsByTool.get(d.function.name) ??
            resolveToolMaxCallsPerTurn({
              name: d.function.name,
              phase: 'read',
            }),
        })),
        ...pluginDecls.map((d) => ({
          name: d.name,
          phase: d.phase,
          maxCallsPerTurn:
            d.maxCallsPerTurn ??
            resolveToolMaxCallsPerTurn({ name: d.name, phase: d.phase }),
        })),
      ]

  const agentSettings = await readAgentSettingsDocument(params.userId)
  const catalog = params.tools
    ? []
    : await collectAgentToolCatalog(params.userId)
  const phaseByTool = catalogPhaseByTool(
    catalog.length > 0
      ? catalog
      : pipelineTools.map((t) => ({
          name: t.name,
          description: t.name,
          phase: (t.phase ?? 'read') as 'read' | 'write',
          maxCallsPerTurn: t.maxCallsPerTurn,
          source: 'core' as const,
        })),
  )
  const toolMeta = pipelineTools.map((t) => ({
    name: t.name,
    phase: (t.phase ?? 'read') as 'read' | 'write',
    maxCallsPerTurn: t.maxCallsPerTurn,
  }))
  let policy
  let runtime: AgentPipelineRuntime
  const graphEdges = agentSettings.edges ?? []
  const useGraphRuntime =
    agentSettings.steps.length > 0 &&
    needsAgentGraphRuntime(agentSettings.steps, graphEdges)

  const agentRunId = randomUUID()
  const regenOrd =
    typeof params.regenerateTurnOrdinal === 'number' &&
    Number.isFinite(params.regenerateTurnOrdinal) &&
    params.regenerateTurnOrdinal >= 0
      ? Math.round(params.regenerateTurnOrdinal)
      : undefined

  try {
    if (agentSettings.steps.length === 0) {
      // 未配置 → 最小种子；坏盘已在 read 时回落为空
      policy = buildPolicyFromEffectiveSteps([], toolMeta)
      runtime = createAgentPipelineRuntime({
        policy,
        toolDefinitions: tools,
        defaultsByTool: maxCallsByTool,
      })
    } else {
      // 非空非法图：明确失败，禁止静默改成种子
      validateAgentGraph(agentSettings.steps, graphEdges, phaseByTool)
      if (useGraphRuntime) {
        if (!conversationId) {
          return {
            ok: false,
            content: '',
            messages: chatMessagesToAgentMessages(params.messages),
            steps: [],
            stopReason: 'graph_invalid',
            errorCode: 'graph_invalid',
            errorDetail: 'graph_runtime_requires_conversation',
            toolsOffered: toolNames,
          }
        }
        const convId = conversationId
        runtime = createAgentGraphRuntime({
          steps: agentSettings.steps,
          edges: graphEdges,
          toolDefinitions: tools,
          toolMeta,
          defaultsByTool: maxCallsByTool,
          runNode: (step) =>
            dispatchAgentNodeCall({
              pluginId: step.pluginId,
              type: step.type,
              conversationId: convId,
              userId: params.userId,
              agentRunId,
              ...(regenOrd !== undefined
                ? { baselineTurnOrdinalExclusive: regenOrd }
                : {}),
            }),
        })
        policy = runtime.policy
      } else {
        policy = buildPolicyFromEffectiveSteps(
          agentSettings.steps,
          toolMeta,
          graphEdges,
        )
        runtime = createAgentPipelineRuntime({
          policy,
          toolDefinitions: tools,
          defaultsByTool: maxCallsByTool,
        })
      }
    }
  } catch (e) {
    const detail =
      e instanceof Error ? e.message : 'agent_graph_invalid'
    return {
      ok: false,
      content: '',
      messages: chatMessagesToAgentMessages(params.messages),
      steps: [],
      stopReason: 'graph_invalid',
      errorCode: 'graph_invalid',
      errorDetail: detail,
      toolsOffered: toolNames,
    }
  }

  // 线性：policy 上全部 write；图：prose 后由游标动态给出当前互斥 write
  const writeToolNameList = useGraphRuntime
    ? []
    : policyWriteToolNames(policy)

  const upstreamComplete =
    params.complete ??
    createChatAgentUpstreamComplete({
      url: params.url,
      apiKey: params.apiKey,
      basePayload: params.basePayload,
      stream: params.streamUpstream === true,
      onDelta: params.onUpstreamDelta,
      generationAbort: params.generationAbort,
    })

  const baseMessages = chatMessagesToAgentMessages(params.messages)
  const seeded = useGraphRuntime
    ? prependAgentToolsSystemPadFromGraph(
        baseMessages,
        agentSettings.steps,
        graphEdges,
        toolNames,
      )
    : prependAgentToolsSystemPadFromPolicy(baseMessages, policy, toolNames)

  await runtime.settlePending()

  const result = await runAgentLoop({
    messages: seeded,
    tools: tools.length > 0 ? tools : undefined,
    resolveTools: () => runtime.offerToolDefinitions(),
    resolveToolChoice: () => runtime.toolChoice(),
    isPipelineComplete: useGraphRuntime
      ? () => runtime.currentStage().id === 'end'
      : undefined,
    prepareStepMessages: ({ messages }) => {
      const instruction = runtime.consumeStageEnterInstruction()
      if (!instruction) return
      messages.push({
        role: 'user',
        content: instruction,
      })
    },
    maxSteps: params.maxSteps,
    signal: params.signal,
    onProgress: (ev) => {
      if (ev.type === 'prose_committed') runtime.onProseCommitted()
      params.onActivity?.()
      params.onProgress?.(ev)
    },
    requiredToolNames: requiredSearchToolNames,
    requiredWriteToolNames: useGraphRuntime
      ? () => runtime.missingPostProseRequired()
      : writeToolNameList,
    executeTool: conversationId
      ? async (name, argsJson, signal) => {
          params.onActivity?.()
          const gate = runtime.assertCallAllowed(name)
          if (!gate.ok) {
            return {
              ok: false as const,
              code: gate.code,
              detail: gate.detail,
            }
          }
          const out = await dispatchAgentToolCall({
            name,
            argsJson,
            conversationId,
            signal,
            userId: params.userId,
            searchContext: params.searchContext,
            agentRunId,
            ...(regenOrd !== undefined
              ? { baselineTurnOrdinalExclusive: regenOrd }
              : {}),
          })
          if (out.ok) {
            runtime.onToolSuccess(name)
          } else {
            runtime.onToolFailure(name, out.code)
          }
          await runtime.settlePending()
          params.onActivity?.()
          return out
        }
      : undefined,
    complete: async (input) => {
      params.onActivity?.()
      const turn = await upstreamComplete(input)
      // 仅 prose 阶段提交；正文前 write（如 init）夹带 content 不得提前锁定
      if (turn.content.trim() && runtime.currentStage().kind === 'prose') {
        runtime.onProseCommitted()
        await runtime.settlePending()
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
    ev.type === 'final' ||
    ev.type === 'prose_committed'
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
              : ev.type === 'prose_committed'
                ? { contentChars: ev.contentChars }
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
          : result.errorCode === 'required_tools_missing' ||
              result.errorCode === 'required_write_tools_missing'
            ? ApiErrorCodes.agent_required_tools_missing
            : result.errorCode === 'upstream_error'
              ? ApiErrorCodes.upstream_api_error
              : result.errorCode === 'graph_invalid'
                ? ApiErrorCodes.agent_graph_invalid
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
