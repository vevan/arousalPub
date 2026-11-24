import {
  AGENT_MAX_TOOL_CALLS_PER_STEP,
  wrapUntrustedToolContent,
} from './agent-limits.js'
import { runRegisteredTool } from './tool-registry.js'
import {
  AGENT_MAX_STEPS_DEFAULT,
  clampAgentMaxSteps,
  type AgentLoopResult,
  type AgentLoopStepTrace,
  type AgentLoopToolTrace,
  type AgentMessage,
  type AgentToolDefinition,
  type AssistantModelTurn,
} from './types.js'

export type AgentLoopCompleteFn = (input: {
  messages: AgentMessage[]
  tools: AgentToolDefinition[] | undefined
  signal: AbortSignal | undefined
  stepIndex: number
}) => Promise<AssistantModelTurn>

export type AgentLoopProgressEvent =
  | {
      type: 'step_start'
      stepIndex: number
      toolsOffered: number
    }
  | {
      type: 'tool_calls'
      stepIndex: number
      tools: AgentLoopToolTrace[]
    }
  | {
      type: 'tool_result'
      stepIndex: number
      tool: AgentLoopToolTrace
    }
  | {
      type: 'final'
      stepIndex: number
      contentChars: number
      finishReason: string
      usedTools: boolean
    }

export interface RunAgentLoopOptions {
  messages: AgentMessage[]
  tools?: AgentToolDefinition[]
  maxSteps?: number
  signal?: AbortSignal
  complete: AgentLoopCompleteFn
  executeTool?: (
    name: string,
    argsJson: string,
    signal: AbortSignal | undefined,
  ) => Promise<{ ok: true; content: string } | { ok: false; code: string; detail?: string }>
  onProgress?: (ev: AgentLoopProgressEvent) => void
  /**
   * 结束前须至少调用过一次的工具名。
   * 提前 stop 时 nudge；若已无剩余步数仍缺工具 → required_tools_missing。
   */
  requiredToolNames?: string[]
  maxToolCallsPerStep?: number
}

function aborted(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted)
}

function calledToolNames(steps: AgentLoopStepTrace[]): Set<string> {
  return new Set(steps.flatMap((s) => s.toolNames ?? []))
}

function missingRequired(
  required: string[] | undefined,
  steps: AgentLoopStepTrace[],
): string[] {
  const need = (required ?? []).map((n) => n.trim()).filter(Boolean)
  if (!need.length) return []
  const called = calledToolNames(steps)
  return need.filter((n) => !called.has(n))
}

/**
 * Generic agent loop：complete → tool_calls → 回灌 → 再 complete。
 */
export async function runAgentLoop(
  opts: RunAgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxSteps = clampAgentMaxSteps(opts.maxSteps ?? AGENT_MAX_STEPS_DEFAULT)
  const maxCallsPerStep = Math.max(
    1,
    Math.min(
      32,
      opts.maxToolCallsPerStep ?? AGENT_MAX_TOOL_CALLS_PER_STEP,
    ),
  )
  const signal = opts.signal
  const executeTool = opts.executeTool ?? runRegisteredTool
  const messages: AgentMessage[] = opts.messages.map((m) => ({ ...m }))
  const steps: AgentLoopStepTrace[] = []
  let lastContent = ''
  let lastReasoning: string | undefined

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    if (aborted(signal)) {
      return {
        ok: false,
        content: lastContent,
        reasoning: lastReasoning,
        messages,
        steps,
        stopReason: 'cancelled',
        errorCode: 'cancelled',
      }
    }

    opts.onProgress?.({
      type: 'step_start',
      stepIndex,
      toolsOffered: opts.tools?.length ?? 0,
    })

    let turn: AssistantModelTurn
    try {
      turn = await opts.complete({
        messages,
        tools: opts.tools,
        signal,
        stepIndex,
      })
    } catch (e) {
      if (aborted(signal)) {
        return {
          ok: false,
          content: lastContent,
          reasoning: lastReasoning,
          messages,
          steps,
          stopReason: 'cancelled',
          errorCode: 'cancelled',
        }
      }
      const detail = e instanceof Error ? e.message : String(e)
      const isUpstream =
        typeof detail === 'string' && /^upstream\s+\d+/.test(detail)
      return {
        ok: false,
        content: lastContent,
        reasoning: lastReasoning,
        messages,
        steps,
        stopReason: 'complete_error',
        errorCode: isUpstream ? 'upstream_error' : 'complete_error',
        errorDetail: detail.slice(0, 2000),
      }
    }

    if (aborted(signal)) {
      return {
        ok: false,
        content: lastContent,
        reasoning: lastReasoning,
        messages,
        steps,
        stopReason: 'cancelled',
        errorCode: 'cancelled',
      }
    }

    lastContent = turn.content
    if (turn.reasoning) lastReasoning = turn.reasoning

    const rawCalls = turn.toolCalls
    const truncatedCalls = rawCalls.slice(0, maxCallsPerStep)
    const wantsTools =
      turn.finishReason === 'tool_calls' || truncatedCalls.length > 0

    const stepTools: AgentLoopToolTrace[] = truncatedCalls.map((t) => ({
      name: t.function.name,
      arguments: t.function.arguments,
    }))
    const stepTrace: AgentLoopStepTrace = {
      stepIndex,
      finishReason: turn.finishReason,
      toolNames: stepTools.map((t) => t.name),
      contentChars: turn.content.length,
      ...(stepTools.length > 0 ? { tools: stepTools } : {}),
    }
    steps.push(stepTrace)

    if (!wantsTools || truncatedCalls.length === 0) {
      const missing = missingRequired(opts.requiredToolNames, steps)
      if (missing.length > 0) {
        if (stepIndex >= maxSteps - 1) {
          return {
            ok: false,
            content: lastContent,
            reasoning: lastReasoning,
            messages,
            steps,
            stopReason: 'required_tools_missing',
            errorCode: 'required_tools_missing',
            errorDetail: missing.join(','),
          }
        }
        messages.push({
          role: 'assistant',
          content: turn.content || null,
        })
        messages.push({
          role: 'user',
          content: `Before your final answer, you must call these tools (you may call several in one step): ${missing.join(', ')}.`,
        })
        continue
      }
      const usedTools = calledToolNames(steps).size > 0
      messages.push({
        role: 'assistant',
        content: turn.content,
      })
      opts.onProgress?.({
        type: 'final',
        stepIndex,
        contentChars: turn.content.length,
        finishReason: turn.finishReason,
        usedTools,
      })
      return {
        ok: true,
        content: turn.content,
        reasoning: lastReasoning,
        messages,
        steps,
        stopReason: 'final',
      }
    }

    opts.onProgress?.({
      type: 'tool_calls',
      stepIndex,
      tools: stepTools.map((t) => ({ ...t })),
    })

    messages.push({
      role: 'assistant',
      content: turn.content || null,
      tool_calls: truncatedCalls,
    })

    for (let ti = 0; ti < truncatedCalls.length; ti++) {
      const tc = truncatedCalls[ti]!
      if (aborted(signal)) {
        return {
          ok: false,
          content: lastContent,
          reasoning: lastReasoning,
          messages,
          steps,
          stopReason: 'cancelled',
          errorCode: 'cancelled',
        }
      }
      const executed = await executeTool(
        tc.function.name,
        tc.function.arguments,
        signal,
      )
      const toolTrace = stepTools[ti]!
      if (!executed.ok) {
        toolTrace.ok = false
        toolTrace.errorCode = executed.code
        toolTrace.result = executed.detail ?? executed.code
        opts.onProgress?.({
          type: 'tool_result',
          stepIndex,
          tool: { ...toolTrace },
        })
        if (executed.code === 'cancelled' || aborted(signal)) {
          return {
            ok: false,
            content: lastContent,
            reasoning: lastReasoning,
            messages,
            steps,
            stopReason: 'cancelled',
            errorCode: 'cancelled',
          }
        }
        // 回灌错误，让模型继续（不再整轮失败）
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: wrapUntrustedToolContent(
            JSON.stringify({
              ok: false,
              code: executed.code,
              detail: executed.detail ?? null,
            }),
          ),
        })
        continue
      }
      toolTrace.ok = true
      toolTrace.result = executed.content
      opts.onProgress?.({
        type: 'tool_result',
        stepIndex,
        tool: { ...toolTrace },
      })
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: wrapUntrustedToolContent(executed.content),
      })
    }
  }

  const missingAtCap = missingRequired(opts.requiredToolNames, steps)
  if (missingAtCap.length > 0) {
    return {
      ok: false,
      content: lastContent,
      reasoning: lastReasoning,
      messages,
      steps,
      stopReason: 'required_tools_missing',
      errorCode: 'required_tools_missing',
      errorDetail: missingAtCap.join(','),
    }
  }

  return {
    ok: false,
    content: lastContent,
    reasoning: lastReasoning,
    messages,
    steps,
    stopReason: 'max_steps',
    errorCode: 'max_steps',
    errorDetail: `exceeded maxSteps=${maxSteps}`,
  }
}
