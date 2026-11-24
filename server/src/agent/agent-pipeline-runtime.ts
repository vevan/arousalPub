/**
 * AgentPipelinePolicy 运行时：逐步推进、offer、tool_choice、进阶指令、越权拒绝。
 */

import {
  isToolCallBudgetExhausted,
  toolCallBudgetRemaining,
} from './agent-tool-budget.js'
import type {
  AgentPipelinePolicy,
  PipelineStage,
  PipelineToolChoice,
  ToolOfferRule,
} from './agent-pipeline-policy.js'
import {
  effectiveMaxCallsForRule,
  policyPreProseRequiredToolNames,
  policyWriteToolNames,
  stageRequiredToolNames,
} from './agent-pipeline-policy.js'
import type { AgentToolDefinition } from './types.js'

export type PipelineAssertResult =
  | { ok: true }
  | {
      ok: false
      code:
        | 'pipeline_stage_rejected'
        | 'tool_call_limit'
        | 'tool_not_in_stage'
        | 'required_tools_pending'
      detail: string
    }

export type AgentPipelineRuntime = {
  policy: AgentPipelinePolicy
  stageIndex: () => number
  currentStage: () => PipelineStage
  proseCommitted: () => boolean
  offerToolDefinitions: () => AgentToolDefinition[] | undefined
  toolChoice: () => PipelineToolChoice
  missingRequired: () => string[]
  missingPreProseRequired: () => string[]
  missingPostProseRequired: () => string[]
  assertCallAllowed: (toolName: string) => PipelineAssertResult
  onToolSuccess: (toolName: string) => void
  onToolFailure: (toolName: string) => void
  onProseCommitted: () => void
  advanceIfReady: () => boolean
  successfulCallCount: (toolName: string) => number
  /**
   * 若刚进入新阶段且尚未下发 instruction，返回指令文本并标记已下发。
   * 供 loop 在 complete 前注入 user 消息。
   */
  consumeStageEnterInstruction: () => string | null
}

function ruleByName(
  stage: PipelineStage,
  toolName: string,
): ToolOfferRule | undefined {
  const n = toolName.trim()
  return stage.offer.find((r) => r.toolName.trim() === n)
}

export function createAgentPipelineRuntime(opts: {
  policy: AgentPipelinePolicy
  toolDefinitions: AgentToolDefinition[]
  defaultsByTool?: ReadonlyMap<string, number>
}): AgentPipelineRuntime {
  const policy = opts.policy
  const defsByName = new Map(
    opts.toolDefinitions.map((d) => [d.function.name, d] as const),
  )
  const defaults = opts.defaultsByTool ?? new Map<string, number>()
  let stageIndex = 0
  let proseCommitted = false
  /** 已向模型下发 instruction 的最高 stageIndex（含） */
  let announcedStageIndex = -1
  const successfulCalls = new Map<string, number>()
  const attemptCalls = new Map<string, number>()

  const stageAt = (i: number): PipelineStage => {
    const s = policy.stages[i]
    if (!s) {
      return (
        policy.stages[policy.stages.length - 1] ?? {
          id: 'prose',
          kind: 'prose',
          step: 1,
          title: 'User-facing reply',
          instruction: 'Write the user-facing reply now.',
          offer: [],
          toolChoice: 'none',
          advanceWhen: 'prose_committed',
        }
      )
    }
    return s
  }

  const currentStage = (): PipelineStage => stageAt(stageIndex)

  const successCount = (name: string): number =>
    successfulCalls.get(name.trim()) ?? 0

  const attemptCount = (name: string): number =>
    attemptCalls.get(name.trim()) ?? 0

  const maxFor = (rule: ToolOfferRule): number =>
    effectiveMaxCallsForRule(rule, defaults)

  const isExhausted = (rule: ToolOfferRule): boolean => {
    const max = maxFor(rule)
    if (!Number.isFinite(max)) {
      return successCount(rule.toolName) >= 1
    }
    return isToolCallBudgetExhausted(max, attemptCount(rule.toolName))
  }

  const missingRequiredInStage = (stage: PipelineStage): string[] => {
    const need = stageRequiredToolNames(stage)
    return need.filter((n) => successCount(n) < 1)
  }

  const offerAllExhausted = (stage: PipelineStage): boolean => {
    if (stage.offer.length === 0) return true
    return stage.offer.every((r) => isExhausted(r))
  }

  const stageGateSatisfied = (stage: PipelineStage): boolean => {
    switch (stage.advanceWhen) {
      case 'required_tools_done':
        return missingRequiredInStage(stage).length === 0
      case 'offer_exhausted':
        return offerAllExhausted(stage)
      case 'prose_committed':
        return proseCommitted
      case 'required_writes_done':
        return missingRequiredInStage(stage).length === 0
      default:
        return true
    }
  }

  const advanceIfReady = (): boolean => {
    let moved = false
    while (stageIndex < policy.stages.length - 1) {
      const cur = stageAt(stageIndex)
      if (!stageGateSatisfied(cur)) break
      if (cur.kind === 'prose' && !proseCommitted) break
      stageIndex += 1
      moved = true
    }
    return moved
  }

  const activeOfferRules = (stage: PipelineStage): ToolOfferRule[] =>
    stage.offer.filter((r) => !isExhausted(r))

  const offerToolDefinitions = (): AgentToolDefinition[] | undefined => {
    advanceIfReady()
    const stage = currentStage()
    if (stage.offer.length === 0) return undefined
    const out: AgentToolDefinition[] = []
    for (const rule of activeOfferRules(stage)) {
      const def = defsByName.get(rule.toolName)
      if (def) out.push(def)
    }
    return out.length > 0 ? out : undefined
  }

  const toolChoice = (): PipelineToolChoice => {
    advanceIfReady()
    const stage = currentStage()
    const offered = offerToolDefinitions()
    if (!offered || offered.length === 0) return 'none'
    if (stage.toolChoice === 'none') return 'none'
    if (stage.toolChoice === 'required') {
      if (
        stage.advanceWhen === 'required_tools_done' ||
        stage.advanceWhen === 'required_writes_done'
      ) {
        if (missingRequiredInStage(stage).length === 0) return 'auto'
      }
      return 'required'
    }
    return stage.toolChoice
  }

  const assertCallAllowed = (toolName: string): PipelineAssertResult => {
    const name = toolName.trim()
    const stage = currentStage()
    const rule = ruleByName(stage, name)
    if (!rule) {
      const allowed = activeOfferRules(stage)
        .map((r) => r.toolName)
        .join(', ')
      return {
        ok: false,
        code: 'pipeline_stage_rejected',
        detail: `Step ${stage.step} (${stage.id}): call only [${allowed || 'none'}]. Got "${name}".`,
      }
    }
    if (!defsByName.has(name)) {
      return {
        ok: false,
        code: 'tool_not_in_stage',
        detail: `Tool ${name} is not registered`,
      }
    }
    if (isExhausted(rule)) {
      return {
        ok: false,
        code: 'tool_call_limit',
        detail: `Tool ${name} already reached max calls this turn (remaining=${toolCallBudgetRemaining(maxFor(rule), attemptCount(name))})`,
      }
    }
    return { ok: true }
  }

  const bumpAttempt = (toolName: string): void => {
    const name = toolName.trim()
    if (!name) return
    attemptCalls.set(name, attemptCount(name) + 1)
  }

  const onToolSuccess = (toolName: string): void => {
    const name = toolName.trim()
    if (!name) return
    bumpAttempt(name)
    successfulCalls.set(name, successCount(name) + 1)
    advanceIfReady()
  }

  const onToolFailure = (toolName: string): void => {
    bumpAttempt(toolName)
    advanceIfReady()
  }

  const onProseCommitted = (): void => {
    proseCommitted = true
    advanceIfReady()
    advanceIfReady()
  }

  const consumeStageEnterInstruction = (): string | null => {
    advanceIfReady()
    if (announcedStageIndex >= stageIndex) return null
    announcedStageIndex = stageIndex
    const stage = currentStage()
    const text = stage.instruction?.trim()
    return text || null
  }

  const writeNames = policyWriteToolNames(policy)
  const preRequired = policyPreProseRequiredToolNames(policy)

  return {
    policy,
    stageIndex: () => stageIndex,
    currentStage,
    proseCommitted: () => proseCommitted,
    offerToolDefinitions,
    toolChoice,
    missingRequired: () => missingRequiredInStage(currentStage()),
    missingPreProseRequired: () =>
      preRequired.filter((n) => successCount(n) < 1),
    missingPostProseRequired: () =>
      writeNames.filter((n) => successCount(n) < 1),
    assertCallAllowed,
    onToolSuccess,
    onToolFailure,
    onProseCommitted,
    advanceIfReady,
    successfulCallCount: successCount,
    consumeStageEnterInstruction,
  }
}
