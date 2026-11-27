/**
 * 图游标运行时（DOC/53 G5）：沿 edges 推进；branch then/else；kind:node → runNode。
 * 对 loop 暴露与 AgentPipelineRuntime 同形 API。
 */

import {
  agentEdgeAdjacency,
  agentStepNodeId,
  indexAgentSteps,
} from './agent-graph.js'
import type {
  AgentBranchPredicate,
  AgentFlowEdgeConfig,
  AgentPipelineStepConfig,
} from './agent-settings-types.js'
import type { CompileToolMeta } from './agent-settings-compile.js'
import {
  isToolCallBudgetExhausted,
  toolCallBudgetRemaining,
  resolveToolMaxCallsPerTurn,
} from './agent-tool-budget.js'
import type {
  AgentPipelinePolicy,
  PipelineStage,
  PipelineToolChoice,
  ToolOfferRule,
} from './agent-pipeline-policy.js'
import type {
  AgentPipelineRuntime,
  PipelineAssertResult,
} from './agent-pipeline-runtime.js'
import type { AgentToolDefinition } from './types.js'
import type { AgentToolPhase } from './agent-prose-phase.js'

export type GraphRunNodeFn = (
  step: Extract<AgentPipelineStepConfig, { kind: 'node' }>,
) => Promise<
  | { ok: true; outputs: Record<string, unknown> }
  | { ok: false; code: string; detail?: string }
>

function singleOut(
  outs: Map<string, AgentFlowEdgeConfig[]>,
  id: string,
): AgentFlowEdgeConfig | undefined {
  const list = outs.get(id) ?? []
  return list.length === 1 ? list[0] : undefined
}

function pickBranchEdge(
  outs: Map<string, AgentFlowEdgeConfig[]>,
  branchId: string,
  takeThen: boolean,
): AgentFlowEdgeConfig | undefined {
  const list = outs.get(branchId) ?? []
  if (list.length === 0) return undefined
  if (list.length === 1) return list[0]
  const thenE = list.find((e) => e.sourceHandle === 'then')
  const elseE = list.find((e) => e.sourceHandle === 'else')
  if (takeThen) return thenE ?? list[0]
  return elseE ?? list.find((e) => e !== thenE) ?? list[1] ?? list[0]
}

function evalPredicate(
  predicate: AgentBranchPredicate | undefined,
  ctx: {
    lastToolOk: boolean | null
    lastToolCode: string | null
    lastNodeOk: boolean | null
  },
): boolean {
  const p = predicate ?? { type: 'prev_node_ok' as const, ok: true }
  if (p.type === 'prev_node_ok') {
    return ctx.lastNodeOk === p.ok
  }
  if (p.type === 'prev_tool_ok') {
    return ctx.lastToolOk === p.ok
  }
  return (ctx.lastToolCode ?? '') === p.equals
}

function resolveMaxCalls(
  step: Extract<AgentPipelineStepConfig, { kind: 'tool' }>,
  meta: CompileToolMeta | undefined,
): number {
  if (step.maxCalls === 'unlimited') return Number.POSITIVE_INFINITY
  if (typeof step.maxCalls === 'number' && Number.isFinite(step.maxCalls)) {
    return step.maxCalls
  }
  if (meta) return meta.maxCallsPerTurn
  return resolveToolMaxCallsPerTurn({ name: step.toolName })
}

function buildSyntheticPolicy(
  steps: AgentPipelineStepConfig[],
  edges: AgentFlowEdgeConfig[],
  metaByName: Map<string, CompileToolMeta>,
): AgentPipelinePolicy {
  // 可达 tool/prose 的概览（不求值分支）；仅供 system pad
  const byId = indexAgentSteps(steps)
  const outs = agentEdgeAdjacency(edges)
  const reachable = new Set<string>(['start'])
  const q = ['start']
  while (q.length) {
    const cur = q.shift()!
    for (const e of outs.get(cur) ?? []) {
      if (reachable.has(e.target)) continue
      reachable.add(e.target)
      q.push(e.target)
    }
  }
  const stages: PipelineStage[] = []
  let n = 0
  for (const id of reachable) {
    const step = byId.get(id)
    if (!step) continue
    if (step.kind === 'tool') {
      n += 1
      const meta = metaByName.get(step.toolName)
      const phase = meta?.phase ?? 'read'
      const maxCalls = resolveMaxCalls(step, meta)
      const required =
        step.required === true ||
        (step.required !== false && phase === 'write')
      stages.push({
        id: phase === 'write' ? `write:${step.toolName}` : `tool:${step.toolName}`,
        kind: phase === 'write' ? 'write' : 'tool',
        step: n,
        title: step.title?.trim() || step.toolName,
        instruction:
          step.instruction?.trim() ||
          `Call ONLY the tool "${step.toolName}" when the host offers it.`,
        offer: [{ toolName: step.toolName, required, maxCalls }],
        toolChoice: step.toolChoice ?? 'required',
        advanceWhen:
          phase === 'write' ? 'required_writes_done' : 'required_tools_done',
      })
    } else if (step.kind === 'prose') {
      n += 1
      stages.push({
        id: 'prose',
        kind: 'prose',
        step: n,
        title: 'User-facing reply',
        instruction:
          step.instruction?.trim() ||
          'Write the full user-facing reply as assistant content now.',
        offer: [],
        toolChoice: 'none',
        advanceWhen: 'prose_committed',
      })
    }
  }
  if (stages.length === 0) {
    stages.push({
      id: 'prose',
      kind: 'prose',
      step: 1,
      title: 'User-facing reply',
      instruction: 'Write the user-facing reply now.',
      offer: [],
      toolChoice: 'none',
      advanceWhen: 'prose_committed',
    })
  }
  return { schemaVersion: 1, stages }
}

function stageForTool(
  step: Extract<AgentPipelineStepConfig, { kind: 'tool' }>,
  meta: CompileToolMeta | undefined,
  stepNum: number,
): PipelineStage {
  const phase: AgentToolPhase = meta?.phase ?? 'read'
  const maxCalls = resolveMaxCalls(step, meta)
  const required =
    step.required === true ||
    (step.required !== false && phase === 'write')
  return {
    id: phase === 'write' ? `write:${step.toolName}` : `tool:${step.toolName}`,
    kind: phase === 'write' ? 'write' : 'tool',
    step: stepNum,
    title: step.title?.trim() || step.toolName,
    instruction:
      step.instruction?.trim() ||
      (phase === 'write'
        ? `Call ONLY the tool "${step.toolName}" now to apply write/mutate updates.`
        : `Call ONLY the tool "${step.toolName}" now. Do not write the user-facing reply yet.`),
    offer: [{ toolName: step.toolName, required, maxCalls }],
    toolChoice: step.toolChoice ?? 'required',
    advanceWhen:
      phase === 'write'
        ? required
          ? 'required_writes_done'
          : 'offer_exhausted'
        : required
          ? 'required_tools_done'
          : 'offer_exhausted',
  }
}

const END_STAGE: PipelineStage = {
  id: 'end',
  kind: 'prose',
  step: 99,
  title: 'Done',
  instruction: '',
  offer: [],
  toolChoice: 'none',
  advanceWhen: 'prose_committed',
}

export function createAgentGraphRuntime(opts: {
  steps: AgentPipelineStepConfig[]
  edges: AgentFlowEdgeConfig[]
  toolDefinitions: AgentToolDefinition[]
  toolMeta: CompileToolMeta[]
  defaultsByTool?: ReadonlyMap<string, number>
  runNode: GraphRunNodeFn
}): AgentPipelineRuntime {
  const byId = indexAgentSteps(opts.steps)
  const outs = agentEdgeAdjacency(opts.edges)
  const defsByName = new Map(
    opts.toolDefinitions.map((d) => [d.function.name, d] as const),
  )
  const metaByName = new Map(
    opts.toolMeta.map((t) => [t.name.trim(), t] as const),
  )
  const defaults = opts.defaultsByTool ?? new Map<string, number>()
  const policy = buildSyntheticPolicy(opts.steps, opts.edges, metaByName)

  let cursor = 'start'
  let proseCommitted = false
  let announcedCursor: string | null = null
  let stepCounter = 0
  let lastToolOk: boolean | null = null
  let lastToolCode: string | null = null
  let lastNodeOk: boolean | null = null
  const successfulCalls = new Map<string, number>()
  const attemptCalls = new Map<string, number>()

  const successCount = (name: string): number =>
    successfulCalls.get(name.trim()) ?? 0
  const attemptCount = (name: string): number =>
    attemptCalls.get(name.trim()) ?? 0

  const currentStep = (): AgentPipelineStepConfig | undefined =>
    byId.get(cursor)

  const maxFor = (rule: ToolOfferRule): number => {
    if (typeof rule.maxCalls === 'number' && Number.isFinite(rule.maxCalls)) {
      return rule.maxCalls
    }
    if (rule.maxCalls === Number.POSITIVE_INFINITY) {
      return Number.POSITIVE_INFINITY
    }
    return defaults.get(rule.toolName.trim()) ?? resolveToolMaxCallsPerTurn({
      name: rule.toolName,
    })
  }

  const isExhausted = (rule: ToolOfferRule): boolean => {
    const max = maxFor(rule)
    if (!Number.isFinite(max)) return false
    if (rule.required === true) {
      return isToolCallBudgetExhausted(max, successCount(rule.toolName))
    }
    return isToolCallBudgetExhausted(max, attemptCount(rule.toolName))
  }

  const buildCurrentStage = (): PipelineStage => {
    const step = currentStep()
    if (!step || step.kind === 'end') return END_STAGE
    if (step.kind === 'prose') {
      return {
        id: 'prose',
        kind: 'prose',
        step: stepCounter || 1,
        title: 'User-facing reply',
        instruction:
          step.instruction?.trim() ||
          'Write the full user-facing reply as assistant content now. No tools are available in this step.',
        offer: [],
        toolChoice: 'none',
        advanceWhen: 'prose_committed',
      }
    }
    if (step.kind === 'tool') {
      return stageForTool(step, metaByName.get(step.toolName), stepCounter || 1)
    }
    // start / node / branch 应被 settle 掉；兜底空 offer
    return {
      id: agentStepNodeId(step),
      kind: 'tool',
      step: stepCounter || 1,
      title: 'Settling',
      instruction: '',
      offer: [],
      toolChoice: 'none',
      advanceWhen: 'required_tools_done',
    }
  }

  const advanceFrom = (id: string): boolean => {
    const edge = singleOut(outs, id)
    if (!edge) return false
    cursor = edge.target
    return true
  }

  const settlePending = async (): Promise<void> => {
    for (let guard = 0; guard < 64; guard++) {
      const step = currentStep()
      if (!step) return
      if (step.kind === 'start') {
        if (!advanceFrom('start')) return
        continue
      }
      if (step.kind === 'end') return
      if (step.kind === 'tool' || step.kind === 'prose') return
      if (step.kind === 'node') {
        const result = await opts.runNode(step)
        if (result.ok) {
          const outOk = result.outputs.ok
          lastNodeOk = typeof outOk === 'boolean' ? outOk : true
        } else {
          lastNodeOk = false
        }
        if (!advanceFrom(agentStepNodeId(step))) return
        continue
      }
      if (step.kind === 'branch') {
        const takeThen = evalPredicate(step.predicate, {
          lastToolOk,
          lastToolCode,
          lastNodeOk,
        })
        const edge = pickBranchEdge(outs, agentStepNodeId(step), takeThen)
        if (!edge) return
        cursor = edge.target
        continue
      }
      return
    }
  }

  const offerToolDefinitions = (): AgentToolDefinition[] | undefined => {
    const stage = buildCurrentStage()
    if (stage.offer.length === 0) return undefined
    const out: AgentToolDefinition[] = []
    for (const rule of stage.offer) {
      if (isExhausted(rule)) continue
      const def = defsByName.get(rule.toolName)
      if (def) out.push(def)
    }
    return out.length > 0 ? out : undefined
  }

  const missingRequiredInStage = (stage: PipelineStage): string[] =>
    stage.offer
      .filter((r) => r.required === true)
      .map((r) => r.toolName)
      .filter((n) => successCount(n) < 1)

  const toolChoice = (): PipelineToolChoice => {
    const stage = buildCurrentStage()
    const offered = offerToolDefinitions()
    if (!offered || offered.length === 0) return 'none'
    if (stage.toolChoice === 'none') return 'none'
    if (stage.toolChoice === 'required') {
      if (missingRequiredInStage(stage).length === 0) return 'auto'
      return 'required'
    }
    return stage.toolChoice
  }

  const assertCallAllowed = (toolName: string): PipelineAssertResult => {
    const name = toolName.trim()
    const stage = buildCurrentStage()
    const rule = stage.offer.find((r) => r.toolName.trim() === name)
    if (!rule) {
      const allowed = stage.offer.map((r) => r.toolName).join(', ')
      return {
        ok: false,
        code: 'pipeline_stage_rejected',
        detail: `Graph cursor ${cursor}: call only [${allowed || 'none'}]. Got "${name}".`,
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
      const max = maxFor(rule)
      const used =
        rule.required === true ? successCount(name) : attemptCount(name)
      return {
        ok: false,
        code: 'tool_call_limit',
        detail: `Tool ${name} already reached max calls this turn (remaining=${toolCallBudgetRemaining(max, used)})`,
      }
    }
    return { ok: true }
  }

  const bumpAttempt = (toolName: string): void => {
    const name = toolName.trim()
    if (!name) return
    attemptCalls.set(name, attemptCount(name) + 1)
  }

  const tryAdvanceAfterToolFailure = (stage: PipelineStage): void => {
    // 可选步：次数耗尽才跳过；成功推进见 onToolSuccess
    if (stage.advanceWhen !== 'offer_exhausted') return
    if (!stage.offer.every((r) => isExhausted(r))) return
    advanceFrom(cursor)
  }

  const onToolSuccess = (toolName: string): void => {
    const name = toolName.trim()
    if (!name) return
    bumpAttempt(name)
    successfulCalls.set(name, successCount(name) + 1)
    lastToolOk = true
    lastToolCode = 'ok'
    const step = currentStep()
    // 图语义：当前 tool 节点一次成功即完成（含 required:false + unlimited write）
    if (step?.kind === 'tool' && step.toolName === name) {
      advanceFrom(cursor)
    }
  }

  const onToolFailure = (toolName: string, code?: string): void => {
    bumpAttempt(toolName)
    lastToolOk = false
    lastToolCode = typeof code === 'string' && code ? code : 'tool_failed'
    tryAdvanceAfterToolFailure(buildCurrentStage())
  }

  const onProseCommitted = (): void => {
    proseCommitted = true
    if (currentStep()?.kind === 'prose') {
      advanceFrom('prose')
    }
  }

  const consumeStageEnterInstruction = (): string | null => {
    const step = currentStep()
    if (!step || step.kind === 'start' || step.kind === 'end') return null
    if (step.kind === 'node' || step.kind === 'branch') return null
    if (announcedCursor === cursor) return null
    announcedCursor = cursor
    stepCounter += 1
    const stage = buildCurrentStage()
    const text = stage.instruction?.trim()
    return text || null
  }

  // stageIndex：用已宣布步数近似
  return {
    policy,
    stageIndex: () => Math.max(0, stepCounter - 1),
    currentStage: buildCurrentStage,
    proseCommitted: () => proseCommitted,
    offerToolDefinitions,
    toolChoice,
    missingRequired: () => missingRequiredInStage(buildCurrentStage()),
    missingPreProseRequired: () => [],
    missingPostProseRequired: () => {
      if (!proseCommitted) return []
      const step = currentStep()
      if (!step || step.kind !== 'tool') return []
      if (successCount(step.toolName) >= 1) return []
      return [step.toolName]
    },
    assertCallAllowed,
    onToolSuccess,
    onToolFailure,
    onProseCommitted,
    advanceIfReady: () => false,
    successfulCallCount: successCount,
    consumeStageEnterInstruction,
    settlePending,
  }
}
