/**
 * Agent 图：节点袋 + 边；主路径 Start↝Prose↝End（DOC/53 §17.11）。
 */

import { AgentSettingsValidationError } from './agent-settings-error.js'
import type {
  AgentFlowEdgeConfig,
  AgentFlowPositions,
  AgentPipelineStepConfig,
} from './agent-settings-types.js'

export function agentStepNodeId(step: AgentPipelineStepConfig): string {
  if (step.kind === 'start') return 'start'
  if (step.kind === 'end') return 'end'
  if (step.kind === 'prose') return 'prose'
  if (step.kind === 'branch') return `branch:${step.id}`
  if (step.kind === 'node') return `node:${step.id}`
  return `tool:${step.toolName}`
}

/** 默认种子：开始 → 正文 → 结束（非旧多工具默认链） */
export function seedMinimalAgentGraph(): {
  steps: AgentPipelineStepConfig[]
  edges: AgentFlowEdgeConfig[]
  positions: AgentFlowPositions
} {
  return {
    steps: [{ kind: 'start' }, { kind: 'prose' }, { kind: 'end' }],
    edges: [
      { id: 'e-start-prose', source: 'start', target: 'prose' },
      { id: 'e-prose-end', source: 'prose', target: 'end' },
    ],
    positions: {
      start: { x: 120, y: 0 },
      prose: { x: 120, y: 120 },
      end: { x: 120, y: 240 },
    },
  }
}

function indexSteps(
  steps: AgentPipelineStepConfig[],
): Map<string, AgentPipelineStepConfig> {
  const map = new Map<string, AgentPipelineStepConfig>()
  for (const s of steps) {
    const id = agentStepNodeId(s)
    if (map.has(id)) {
      throw new AgentSettingsValidationError(`duplicate_node_id:${id}`)
    }
    map.set(id, s)
  }
  return map
}

function adjacency(
  edges: AgentFlowEdgeConfig[],
): Map<string, AgentFlowEdgeConfig[]> {
  const out = new Map<string, AgentFlowEdgeConfig[]>()
  for (const e of edges) {
    const list = out.get(e.source) ?? []
    list.push(e)
    out.set(e.source, list)
  }
  return out
}

function indegreeMap(
  edges: AgentFlowEdgeConfig[],
): Map<string, number> {
  const indeg = new Map<string, number>()
  for (const e of edges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
    if (!indeg.has(e.source)) indeg.set(e.source, indeg.get(e.source) ?? 0)
  }
  return indeg
}

/**
 * 自 start 沿唯一出边走到 end；遇多出边（未求值 branch）失败。
 * 返回主路径上的全部步骤（含 start/end/branch/node）。
 */
export function walkMainPath(
  steps: AgentPipelineStepConfig[],
  edges: AgentFlowEdgeConfig[],
): AgentPipelineStepConfig[] {
  const byId = indexSteps(steps)
  if (!byId.has('start') || !byId.has('prose') || !byId.has('end')) {
    throw new AgentSettingsValidationError('graph_skeleton_required')
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      throw new AgentSettingsValidationError('edge_endpoint_missing')
    }
  }
  const outs = adjacency(edges)
  const indeg = indegreeMap(edges)
  if ((indeg.get('start') ?? 0) > 0) {
    throw new AgentSettingsValidationError('start_has_incoming')
  }
  if ((outs.get('end')?.length ?? 0) > 0) {
    throw new AgentSettingsValidationError('end_has_outgoing')
  }

  const path: AgentPipelineStepConfig[] = []
  const seen = new Set<string>()
  let cur = 'start'
  for (;;) {
    if (seen.has(cur)) {
      throw new AgentSettingsValidationError('graph_cycle')
    }
    seen.add(cur)
    const step = byId.get(cur)
    if (!step) throw new AgentSettingsValidationError('edge_endpoint_missing')
    path.push(step)
    if (cur === 'end') break
    const nextEdges = outs.get(cur) ?? []
    if (nextEdges.length === 0) {
      throw new AgentSettingsValidationError('graph_path_broken')
    }
    if (nextEdges.length > 1) {
      throw new AgentSettingsValidationError('branch_execution_not_ready')
    }
    cur = nextEdges[0]!.target
  }

  const proseIdx = path.findIndex((s) => s.kind === 'prose')
  if (proseIdx < 0) {
    throw new AgentSettingsValidationError('prose_not_on_main_path')
  }
  const endIdx = path.findIndex((s) => s.kind === 'end')
  if (proseIdx >= endIdx) {
    throw new AgentSettingsValidationError('prose_not_before_end')
  }
  return path
}

/**
 * 校验节点袋 + 边：骨架齐全、主路径可达、工具名合法；允许无边孤儿。
 */
export function validateAgentGraph(
  steps: AgentPipelineStepConfig[],
  edges: AgentFlowEdgeConfig[] | undefined,
  phaseByTool: ReadonlyMap<string, 'read' | 'write'>,
): void {
  if (steps.length === 0) return

  const startCount = steps.filter((s) => s.kind === 'start').length
  const endCount = steps.filter((s) => s.kind === 'end').length
  const proseCount = steps.filter((s) => s.kind === 'prose').length
  if (startCount !== 1 || endCount !== 1 || proseCount !== 1) {
    throw new AgentSettingsValidationError('graph_skeleton_required')
  }

  const seenTools = new Set<string>()
  const seenBranchIds = new Set<string>()
  const seenNodeIds = new Set<string>()
  for (const s of steps) {
    if (s.kind === 'tool') {
      if (seenTools.has(s.toolName)) {
        throw new AgentSettingsValidationError('duplicate_tool_in_pipeline')
      }
      seenTools.add(s.toolName)
    } else if (s.kind === 'branch') {
      if (seenBranchIds.has(s.id)) {
        throw new AgentSettingsValidationError('duplicate_branch_id')
      }
      seenBranchIds.add(s.id)
    } else if (s.kind === 'node') {
      if (seenNodeIds.has(s.id)) {
        throw new AgentSettingsValidationError('duplicate_node_id')
      }
      seenNodeIds.add(s.id)
    }
  }

  const edgeList = edges ?? []
  indexSteps(steps)
  const path = walkMainPath(steps, edgeList)
  // 仅主路径上的 tool 须在 catalog；孤儿可挂未知工具供调试
  if (phaseByTool.size > 0) {
    for (const s of path) {
      if (s.kind !== 'tool') continue
      if (!phaseByTool.has(s.toolName)) {
        throw new AgentSettingsValidationError(`unknown_tool:${s.toolName}`)
      }
    }
  }
}

/** 主路径上可进 loop 的步骤（跳过 start/end/branch/node） */
export function mainPathRunnableSteps(
  steps: AgentPipelineStepConfig[],
  edges: AgentFlowEdgeConfig[] | undefined,
): Extract<AgentPipelineStepConfig, { kind: 'tool' | 'prose' }>[] {
  const path = walkMainPath(steps, edges ?? [])
  return path.filter(
    (s): s is Extract<AgentPipelineStepConfig, { kind: 'tool' | 'prose' }> =>
      s.kind === 'tool' || s.kind === 'prose',
  )
}
