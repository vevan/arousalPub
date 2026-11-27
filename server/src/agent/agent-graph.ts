/**
 * Agent 图：节点袋 + 边；Start↝Prose↝End（DOC/53 §17.11 / G5）。
 * 保存校验允许 branch 双出边；线性 walk 仅用于无分支编译。
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

export function indexAgentSteps(
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

export function agentEdgeAdjacency(
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

function isBranchStep(
  step: AgentPipelineStepConfig | undefined,
): boolean {
  return step?.kind === 'branch'
}

/**
 * 保存用结构校验：允许 branch 多出边；非 branch 至多一出边。
 * 要求从 start 出发能到达 prose 与 end（可经不同支路）。
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
  const byId = indexAgentSteps(steps)
  for (const e of edgeList) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      throw new AgentSettingsValidationError('edge_endpoint_missing')
    }
  }

  const outs = agentEdgeAdjacency(edgeList)
  const indeg = indegreeMap(edgeList)
  if ((indeg.get('start') ?? 0) > 0) {
    throw new AgentSettingsValidationError('start_has_incoming')
  }
  if ((outs.get('end')?.length ?? 0) > 0) {
    throw new AgentSettingsValidationError('end_has_outgoing')
  }

  for (const [id, outEdges] of outs) {
    const step = byId.get(id)
    if (!step) continue
    if (isBranchStep(step)) {
      if (outEdges.length > 2) {
        throw new AgentSettingsValidationError('branch_too_many_outs')
      }
      continue
    }
    if (outEdges.length > 1) {
      throw new AgentSettingsValidationError('non_branch_multi_out')
    }
  }

  // BFS：从 start 可达的节点（branch 展开全部出边）
  const reachable = new Set<string>()
  const queue = ['start']
  reachable.add('start')
  while (queue.length) {
    const cur = queue.shift()!
    for (const e of outs.get(cur) ?? []) {
      if (reachable.has(e.target)) continue
      reachable.add(e.target)
      queue.push(e.target)
    }
  }
  if (!reachable.has('prose')) {
    throw new AgentSettingsValidationError('prose_not_on_main_path')
  }
  if (!reachable.has('end')) {
    throw new AgentSettingsValidationError('graph_path_broken')
  }

  // 从 start 到 end 的任一条简单路径上 prose 须出现在 end 之前：
  // 用「end 的祖先中含 prose」近似：prose 可达 end
  const fromProse = new Set<string>()
  const q2 = ['prose']
  fromProse.add('prose')
  while (q2.length) {
    const cur = q2.shift()!
    for (const e of outs.get(cur) ?? []) {
      if (fromProse.has(e.target)) continue
      fromProse.add(e.target)
      q2.push(e.target)
    }
  }
  if (!fromProse.has('end')) {
    throw new AgentSettingsValidationError('prose_not_before_end')
  }

  if (phaseByTool.size > 0) {
    for (const id of reachable) {
      const s = byId.get(id)
      if (!s || s.kind !== 'tool') continue
      if (!phaseByTool.has(s.toolName)) {
        throw new AgentSettingsValidationError(`unknown_tool:${s.toolName}`)
      }
    }
  }
}

/**
 * 自 start 沿唯一出边走到 end（无分支图 / 编译用）。
 * 遇非 branch 多出边或 branch 多出边均失败——分支图请用图运行时。
 */
export function walkMainPath(
  steps: AgentPipelineStepConfig[],
  edges: AgentFlowEdgeConfig[],
): AgentPipelineStepConfig[] {
  const byId = indexAgentSteps(steps)
  if (!byId.has('start') || !byId.has('prose') || !byId.has('end')) {
    throw new AgentSettingsValidationError('graph_skeleton_required')
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      throw new AgentSettingsValidationError('edge_endpoint_missing')
    }
  }
  const outs = agentEdgeAdjacency(edges)
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

export function graphHasBranchOrNode(
  steps: AgentPipelineStepConfig[],
): boolean {
  return steps.some((s) => s.kind === 'branch' || s.kind === 'node')
}

/** 自 start 沿全部出边 BFS 可达的节点 id */
export function reachableNodeIdsFromStart(
  steps: AgentPipelineStepConfig[],
  edges: AgentFlowEdgeConfig[],
): Set<string> {
  const byId = indexAgentSteps(steps)
  if (!byId.has('start')) return new Set()
  const outs = agentEdgeAdjacency(edges)
  const reachable = new Set<string>(['start'])
  const queue = ['start']
  while (queue.length) {
    const cur = queue.shift()!
    for (const e of outs.get(cur) ?? []) {
      if (!byId.has(e.target) || reachable.has(e.target)) continue
      reachable.add(e.target)
      queue.push(e.target)
    }
  }
  return reachable
}

/**
 * 可达集含 branch / node → 须用图游标运行时（G5），不可仅靠线性 walk 编译。
 */
export function needsAgentGraphRuntime(
  steps: AgentPipelineStepConfig[],
  edges: AgentFlowEdgeConfig[] | undefined,
): boolean {
  if (steps.length === 0) return false
  const byId = indexAgentSteps(steps)
  const reachable = reachableNodeIdsFromStart(steps, edges ?? [])
  for (const id of reachable) {
    const s = byId.get(id)
    if (s?.kind === 'branch' || s?.kind === 'node') return true
  }
  return false
}

/** 主路径上可进 loop 的步骤（仅线性图） */
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
