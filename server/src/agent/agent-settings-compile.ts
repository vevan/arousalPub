/**
 * 图主路径 → AgentPipelinePolicy（DOC/53 §17.11）。
 */

import type {
  AgentPipelinePolicy,
  PipelineAdvanceWhen,
  PipelineStage,
  PipelineToolChoice,
} from './agent-pipeline-policy.js'
import type { AgentToolPhase } from './agent-prose-phase.js'
import { resolveToolMaxCallsPerTurn } from './agent-tool-budget.js'
import {
  mainPathRunnableSteps,
  needsAgentGraphRuntime,
  seedMinimalAgentGraph,
} from './agent-graph.js'
import { createAgentGraphRuntime } from './agent-graph-runtime.js'
import type {
  AgentFlowEdgeConfig,
  AgentPipelineStepConfig,
} from './agent-settings-types.js'

export type CompileToolMeta = {
  name: string
  phase: AgentToolPhase
  maxCallsPerTurn: number
}

function resolveMaxCalls(
  step: Extract<AgentPipelineStepConfig, { kind: 'tool' }>,
  meta: CompileToolMeta | undefined,
): number {
  if (step.maxCalls === 'unlimited') {
    return Number.POSITIVE_INFINITY
  }
  if (typeof step.maxCalls === 'number' && Number.isFinite(step.maxCalls)) {
    return step.maxCalls
  }
  if (meta) return meta.maxCallsPerTurn
  return resolveToolMaxCallsPerTurn({ name: step.toolName })
}

function defaultAdvanceWhen(
  step: Extract<AgentPipelineStepConfig, { kind: 'tool' }>,
  phase: AgentToolPhase,
): PipelineAdvanceWhen {
  if (step.advanceWhen) return step.advanceWhen
  if (phase === 'write') {
    if (step.required === false) return 'offer_exhausted'
    return 'required_writes_done'
  }
  if (step.required === true) return 'required_tools_done'
  return 'offer_exhausted'
}

function defaultToolChoice(
  step: Extract<AgentPipelineStepConfig, { kind: 'tool' }>,
): PipelineToolChoice {
  return step.toolChoice ?? 'required'
}

/**
 * 将图（节点袋 + 边）编译为 runtime policy。
 * 空图 → 最小种子 start→prose→end。
 */
export function compileAgentPipelinePolicyFromSteps(
  steps: AgentPipelineStepConfig[],
  toolMeta: CompileToolMeta[],
  edges?: AgentFlowEdgeConfig[],
): AgentPipelinePolicy {
  const metaByName = new Map(
    toolMeta.map((t) => [t.name.trim(), t] as const),
  )
  const graph =
    steps.length === 0
      ? seedMinimalAgentGraph()
      : { steps, edges: edges ?? [] }
  // 含 branch/node：不能线性 walk；合成可达 tool/prose 预览（执行走图游标）
  if (needsAgentGraphRuntime(graph.steps, graph.edges)) {
    return createAgentGraphRuntime({
      steps: graph.steps,
      edges: graph.edges,
      toolDefinitions: toolMeta.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.name,
          parameters: { type: 'object', properties: {} },
        },
      })),
      toolMeta,
      runNode: async () => ({ ok: false as const, code: 'compile_preview' }),
    }).policy
  }
  const runnable = mainPathRunnableSteps(graph.steps, graph.edges)
  const total = runnable.length
  const proseIdx = runnable.findIndex((s) => s.kind === 'prose')
  const stages: PipelineStage[] = runnable.map((step, i) => {
    const n = i + 1
    if (step.kind === 'prose') {
      return {
        id: 'prose',
        kind: 'prose',
        step: n,
        title: 'User-facing reply',
        instruction:
          step.instruction?.trim() ||
          `[Pipeline step ${n}/${total}] Write the full user-facing reply as assistant content now. No tools are available in this step.`,
        offer: [],
        toolChoice: 'none',
        advanceWhen: 'prose_committed',
      }
    }
    const meta = metaByName.get(step.toolName)
    const phase = meta?.phase ?? 'read'
    const maxCalls = resolveMaxCalls(step, meta)
    const required =
      step.required === true ||
      (step.required !== false && phase === 'write')
    const beforeProse = proseIdx < 0 || i < proseIdx
    const title =
      step.title?.trim() ||
      (phase === 'write'
        ? `Write · ${step.toolName}`
        : required
          ? `Required search · ${step.toolName}`
          : `Read · ${step.toolName}`)
    let instruction = step.instruction?.trim() || ''
    if (!instruction) {
      if (phase === 'write') {
        instruction = required
          ? beforeProse
            ? `[Pipeline step ${n}/${total}] Call ONLY the tool "${step.toolName}" now to initialize/mutate state. Do not call other tools. Do not write the user-facing reply yet.`
            : `[Pipeline step ${n}/${total}] The user-facing reply is done. Call ONLY the tool "${step.toolName}" now to apply write/mutate updates. Prefer one call with all needed ops.`
          : `[Pipeline step ${n}/${total}] Call ONLY the tool "${step.toolName}" now if applicable (skip when its precondition is unmet). Do not call other tools.`
      } else {
        instruction = `[Pipeline step ${n}/${total}] Call ONLY the tool "${step.toolName}" now. Do not call any other tool. Do not write the user-facing reply yet.`
      }
    }
    return {
      id: phase === 'write' ? `write:${step.toolName}` : `tool:${step.toolName}`,
      kind: phase === 'write' ? ('write' as const) : ('tool' as const),
      step: n,
      title,
      instruction,
      offer: [
        {
          toolName: step.toolName,
          required,
          maxCalls,
        },
      ],
      toolChoice: defaultToolChoice(step),
      advanceWhen: defaultAdvanceWhen(step, phase),
    }
  })
  return { schemaVersion: 1, stages }
}
