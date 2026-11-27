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
  /** 流水线策略下发的 tool_choice；缺省由 complete 自行决定 */
  toolChoice?: 'auto' | 'required' | 'none'
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
  | {
      /** 正文已确认（例如即将 nudge write）；SSE 应锁定主泡，勿再 clear */
      type: 'prose_committed'
      stepIndex: number
      contentChars: number
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
   * 结束前须至少调用过一次的工具名（通常为绑定检索）。
   * 提前 stop 时 nudge；若已无剩余步数仍缺工具 → required_tools_missing。
   */
  requiredToolNames?: string[]
  /**
   * 正文已产出后须成功调用的 write 工具名（manifest phase=write）。
   * 仅当本轮已有非空 assistant content 时检查；失败调用不计入。
   * 可为函数：图游标在 prose 后 settle 到互斥 write 时动态返回当前节点。
   */
  requiredWriteToolNames?: string[] | (() => string[])
  maxToolCallsPerStep?: number
  /**
   * 每步动态工具列表（预算耗尽 / 相位隐藏后）。
   * 未提供时使用 `tools`。
   * 返回 `undefined` 表示本步不提供任何 tool（勿用 ?? 回退全量）。
   */
  resolveTools?: (ctx: {
    stepIndex: number
    steps: AgentLoopStepTrace[]
    userFacingContentLocked: boolean
  }) => AgentToolDefinition[] | undefined
  /**
   * 每步 tool_choice（流水线策略）。未提供时：有 tools → auto。
   */
  resolveToolChoice?: (ctx: {
    stepIndex: number
    steps: AgentLoopStepTrace[]
    userFacingContentLocked: boolean
  }) => 'auto' | 'required' | 'none'
  /**
   * 图游标已到 end（或等价完成）时：tool 回灌后勿再调模型，直接 final。
   */
  isPipelineComplete?: () => boolean
  /**
   * 每步 complete 前：可向 messages 追加指令（逐步精细控制）。
   * messages 为可变数组。
   */
  prepareStepMessages?: (ctx: {
    stepIndex: number
    messages: AgentMessage[]
    tools: AgentToolDefinition[] | undefined
  }) => void
}

function aborted(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted)
}

function calledToolNames(steps: AgentLoopStepTrace[]): Set<string> {
  return new Set(steps.flatMap((s) => s.toolNames ?? []))
}

function calledSuccessfulToolNames(steps: AgentLoopStepTrace[]): Set<string> {
  const out = new Set<string>()
  for (const s of steps) {
    for (const t of s.tools ?? []) {
      const name = t.name?.trim()
      // 仅 ok===true；未执行（undefined）与失败均不算满足必调
      if (name && t.ok === true) out.add(name)
    }
  }
  return out
}

/** 必调检索/门禁：须至少成功一次（失败调用不算满足） */
function missingRequired(
  required: string[] | undefined,
  steps: AgentLoopStepTrace[],
): string[] {
  const need = (required ?? []).map((n) => n.trim()).filter(Boolean)
  if (!need.length) return []
  const called = calledSuccessfulToolNames(steps)
  return need.filter((n) => !called.has(n))
}

function missingRequiredSuccessful(
  required: string[] | undefined,
  steps: AgentLoopStepTrace[],
): string[] {
  return missingRequired(required, steps)
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
  /** 用户可见正文已锁定后，后续步的 content（meta 话术）不得覆盖落盘正文 */
  let userFacingContentLocked = false
  const resolveRequiredWriteToolNames = (): string[] => {
    const raw =
      typeof opts.requiredWriteToolNames === 'function'
        ? opts.requiredWriteToolNames()
        : (opts.requiredWriteToolNames ?? [])
    return raw.map((n) => n.trim()).filter(Boolean)
  }
  /** 静态名单（线性流水线）；图模式另见 resolveRequiredWriteToolNames */
  const staticWriteNameSet = new Set(
    typeof opts.requiredWriteToolNames === 'function'
      ? []
      : (opts.requiredWriteToolNames ?? []).map((n) => n.trim()).filter(Boolean),
  )

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

    // 注意：resolveTools 返回 undefined 表示「本步不提供任何 tool」，不能用 ?? 回退到全量 tools
    const resolveCtx = {
      stepIndex,
      steps,
      userFacingContentLocked,
    }
    const toolsThisStep = opts.resolveTools
      ? opts.resolveTools(resolveCtx)
      : opts.tools
    const toolChoiceThisStep = opts.resolveToolChoice?.(resolveCtx)

    opts.prepareStepMessages?.({
      stepIndex,
      messages,
      tools: toolsThisStep,
    })

    opts.onProgress?.({
      type: 'step_start',
      stepIndex,
      toolsOffered: toolsThisStep?.length ?? 0,
    })

    let turn: AssistantModelTurn
    try {
      turn = await opts.complete({
        messages,
        tools: toolsThisStep,
        ...(toolChoiceThisStep ? { toolChoice: toolChoiceThisStep } : {}),
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

    // 锁定前才采纳 content；锁定后忽略 write 步 meta（否则 persist 冲掉主泡）
    if (turn.content.trim() && !userFacingContentLocked) {
      lastContent = turn.content
    }
    // 不因「tool_calls 里有 write 名」预锁：读步误夹且被 pipeline 拒绝时不得锁死泄漏正文。
    // write 成功后再锁（见下方工具循环后）；纯正文收尾在此锁定。
    if (
      !userFacingContentLocked &&
      lastContent.trim() &&
      !wantsTools &&
      missingRequired(opts.requiredToolNames, steps).length === 0
    ) {
      userFacingContentLocked = true
    }
    if (turn.reasoning) lastReasoning = turn.reasoning

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
      const proseSoFar = lastContent.trim() || turn.content.trim()
      if (proseSoFar) {
        const missingWrite = missingRequiredSuccessful(
          resolveRequiredWriteToolNames(),
          steps,
        )
        if (missingWrite.length > 0) {
          if (stepIndex >= maxSteps - 1) {
            return {
              ok: false,
              content: lastContent || turn.content,
              reasoning: lastReasoning,
              messages,
              steps,
              stopReason: 'required_write_tools_missing',
              errorCode: 'required_write_tools_missing',
              errorDetail: missingWrite.join(','),
            }
          }
          userFacingContentLocked = true
          opts.onProgress?.({
            type: 'prose_committed',
            stepIndex,
            contentChars: proseSoFar.length,
          })
          messages.push({
            role: 'assistant',
            content: lastContent || turn.content || null,
          })
          messages.push({
            role: 'user',
            content: `Your user-facing reply is done and locked. Do NOT output more story text. Only call these write/mutate tools (prefer one call with all field ops; more calls OK if needed): ${missingWrite.join(', ')}.`,
          })
          continue
        }
      }
      const usedTools = calledToolNames(steps).size > 0
      const finalContent = userFacingContentLocked
        ? lastContent
        : turn.content.trim()
          ? turn.content
          : lastContent
      messages.push({
        role: 'assistant',
        content: finalContent || null,
      })
      opts.onProgress?.({
        type: 'final',
        stepIndex,
        contentChars: finalContent.length,
        finishReason: turn.finishReason,
        usedTools,
      })
      return {
        ok: true,
        content: finalContent,
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

    // 仅当本步 write 工具真正成功时锁定正文（拒绝/失败的 write 名不锁）
    if (
      !userFacingContentLocked &&
      lastContent.trim() &&
      stepTools.some((t) => {
        const n = t.name.trim()
        return (
          t.ok === true &&
          (staticWriteNameSet.has(n) ||
            resolveRequiredWriteToolNames().includes(n))
        )
      })
    ) {
      userFacingContentLocked = true
    }

    // 图游标到 end：勿再让模型对着 tool_result 空转（否则会臆造 init 等下一步）
    if (opts.isPipelineComplete?.()) {
      const usedTools = calledToolNames(steps).size > 0
      opts.onProgress?.({
        type: 'final',
        stepIndex,
        contentChars: lastContent.length,
        finishReason: 'stop',
        usedTools,
      })
      return {
        ok: true,
        content: lastContent,
        reasoning: lastReasoning,
        messages,
        steps,
        stopReason: 'final',
      }
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
  if (lastContent.trim()) {
    const missingWriteAtCap = missingRequiredSuccessful(
      resolveRequiredWriteToolNames(),
      steps,
    )
    if (missingWriteAtCap.length > 0) {
      return {
        ok: false,
        content: lastContent,
        reasoning: lastReasoning,
        messages,
        steps,
        stopReason: 'required_write_tools_missing',
        errorCode: 'required_write_tools_missing',
        errorDetail: missingWriteAtCap.join(','),
      }
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
