/**
 * Agent 编排：steps 袋 + edges + positions ↔ Vue Flow（DOC/53 §17.11）。
 * 执行序只由边决定；坐标仅布局。
 */

import type { Edge, Node } from '@xyflow/vue'
import type {
  AgentFlowEdgeConfig,
  AgentFlowPositions,
  AgentPipelineStepConfig,
} from '@/types/agent-settings'

export const AGENT_FLOW_NODE_TOOL = 'agentTool'
export const AGENT_FLOW_NODE_PROSE = 'agentProse'
export const AGENT_FLOW_NODE_BRANCH = 'agentBranch'
export const AGENT_FLOW_NODE_PLUGIN = 'agentPluginNode'
export const AGENT_FLOW_NODE_START = 'agentStart'
export const AGENT_FLOW_NODE_END = 'agentEnd'

export type AgentFlowNodeData = {
  step: AgentPipelineStepConfig
  phase?: 'read' | 'write'
  label: string
}

export type AgentFlowNode = Node<AgentFlowNodeData>

const X_BASE = 120
const Y_GAP = 120

export function stepNodeId(step: AgentPipelineStepConfig): string {
  if (step.kind === 'start') return 'start'
  if (step.kind === 'end') return 'end'
  if (step.kind === 'prose') return 'prose'
  if (step.kind === 'branch') return `branch:${step.id}`
  if (step.kind === 'node') return `node:${step.id}`
  return `tool:${step.toolName}`
}

/** 最小可用图：开始 → 正文 → 结束 */
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
      start: { x: X_BASE, y: 0 },
      prose: { x: X_BASE, y: Y_GAP },
      end: { x: X_BASE, y: Y_GAP * 2 },
    },
  }
}

function withEdgeDefaults(edge: Edge): Edge {
  return {
    ...edge,
    selectable: true,
    focusable: true,
    deletable: true,
    interactionWidth: 24,
  }
}

/** 按给定节点 id 顺序生成链式边 */
export function buildChainEdges(nodeIds: string[]): Edge[] {
  const edges: Edge[] = []
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const a = nodeIds[i]!
    const b = nodeIds[i + 1]!
    edges.push(
      withEdgeDefaults({
        id: `e-${a}-${b}`,
        source: a,
        target: b,
      }),
    )
  }
  return edges
}

export function stepsToFlowElements(
  steps: AgentPipelineStepConfig[],
  opts: {
    phaseOf: (toolName: string) => 'read' | 'write' | undefined
    proseLabel: string
    branchLabel: string
    startLabel?: string
    endLabel?: string
    /** 画布显示标题（人机 i18n）；缺省回退 step.title / 名 */
    labelOf?: (step: AgentPipelineStepConfig) => string
    edges?: AgentFlowEdgeConfig[]
    positions?: AgentFlowPositions
    /**
     * 无显式边时是否按 steps 顺序自动串链。
     * 仅预览缺边时使用；有边后勿再强制。
     */
    autoChain?: boolean
  },
): { nodes: AgentFlowNode[]; edges: Edge[] } {
  const positions = opts.positions ?? {}
  const nodes: AgentFlowNode[] = steps.map((step, i) => {
    const id = stepNodeId(step)
    const saved = positions[id]
    const position = saved
      ? { x: saved.x, y: saved.y }
      : { x: X_BASE, y: i * Y_GAP }
    const customLabel = opts.labelOf?.(step)?.trim()
    if (step.kind === 'start') {
      return {
        id,
        type: AGENT_FLOW_NODE_START,
        position,
        data: {
          step,
          label: customLabel || opts.startLabel || 'Start',
        },
        deletable: false,
      }
    }
    if (step.kind === 'end') {
      return {
        id,
        type: AGENT_FLOW_NODE_END,
        position,
        data: {
          step,
          label: customLabel || opts.endLabel || 'End',
        },
        deletable: false,
      }
    }
    if (step.kind === 'prose') {
      return {
        id,
        type: AGENT_FLOW_NODE_PROSE,
        position,
        data: { step, label: customLabel || opts.proseLabel },
        deletable: false,
      }
    }
    if (step.kind === 'branch') {
      return {
        id,
        type: AGENT_FLOW_NODE_BRANCH,
        position,
        data: {
          step,
          label: customLabel || step.title?.trim() || opts.branchLabel,
        },
        deletable: true,
      }
    }
    if (step.kind === 'node') {
      return {
        id,
        type: AGENT_FLOW_NODE_PLUGIN,
        position,
        data: {
          step,
          label: customLabel || step.title?.trim() || step.type,
        },
        deletable: true,
      }
    }
    return {
      id,
      type: AGENT_FLOW_NODE_TOOL,
      position,
      data: {
        step,
        phase: opts.phaseOf(step.toolName),
        label: customLabel || step.title?.trim() || step.toolName,
      },
      deletable: true,
    }
  })

  const idSet = new Set(nodes.map((n) => n.id))
  if (opts.edges && opts.edges.length > 0) {
    const edges: Edge[] = []
    for (const e of opts.edges) {
      if (!idSet.has(e.source) || !idSet.has(e.target)) continue
      edges.push(
        withEdgeDefaults({
          id: e.id,
          source: e.source,
          target: e.target,
          ...(e.sourceHandle != null
            ? { sourceHandle: String(e.sourceHandle) }
            : {}),
          ...(e.targetHandle != null
            ? { targetHandle: String(e.targetHandle) }
            : {}),
        }),
      )
    }
    return { nodes, edges }
  }

  if (opts.autoChain) {
    return { nodes, edges: buildChainEdges(nodes.map((n) => n.id)) }
  }
  return { nodes, edges: [] }
}

/**
 * 保存用结构校验（与服务端 validateAgentGraph 对齐）：允许 branch 双出边；
 * 成功时带回自 start 可达节点 id，供「仅校验可达集上的未知工具」。
 */
export function validateMainPathLocal(
  steps: AgentPipelineStepConfig[],
  edges: AgentFlowEdgeConfig[],
): { error: string } | { pathIds: string[] } {
  if (steps.length === 0) return { pathIds: [] }
  const startN = steps.filter((s) => s.kind === 'start').length
  const endN = steps.filter((s) => s.kind === 'end').length
  const proseN = steps.filter((s) => s.kind === 'prose').length
  if (startN !== 1 || endN !== 1 || proseN !== 1) {
    return { error: 'errGraphSkeleton' }
  }
  const byId = new Map(steps.map((s) => [stepNodeId(s), s] as const))
  const outs = new Map<string, AgentFlowEdgeConfig[]>()
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      return { error: 'errEdgeEndpoint' }
    }
    const list = outs.get(e.source) ?? []
    list.push(e)
    outs.set(e.source, list)
  }
  for (const e of edges) {
    if (e.target === 'start') return { error: 'errStartIncoming' }
    if (e.source === 'end') return { error: 'errEndOutgoing' }
  }
  for (const [id, outEdges] of outs) {
    const step = byId.get(id)
    if (!step) continue
    if (step.kind === 'branch') {
      if (outEdges.length > 2) return { error: 'errBranchTooManyOuts' }
      continue
    }
    if (outEdges.length > 1) return { error: 'errNonBranchMultiOut' }
  }

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
  if (!reachable.has('prose')) return { error: 'errProseNotOnPath' }
  if (!reachable.has('end')) return { error: 'errGraphPathBroken' }

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
  if (!fromProse.has('end')) return { error: 'errProseNotBeforeEnd' }

  return { pathIds: [...reachable] }
}

/**
 * 导出边与坐标；步骤顺序保留 orderIds（不因拖拽 y 重排）。
 */
export function flowToStepsAndEdges(
  nodes: AgentFlowNode[],
  edges: Edge[],
  opts?: { orderIds?: string[] },
): {
  steps: AgentPipelineStepConfig[]
  edges: AgentFlowEdgeConfig[]
  positions: AgentFlowPositions
} {
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const steps: AgentPipelineStepConfig[] = []
  const used = new Set<string>()
  for (const id of opts?.orderIds ?? []) {
    const n = byId.get(id)
    if (!n) continue
    steps.push(n.data.step)
    used.add(id)
  }
  for (const n of nodes) {
    if (used.has(n.id)) continue
    steps.push(n.data.step)
  }
  const outEdges: AgentFlowEdgeConfig[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
  }))
  const positions: AgentFlowPositions = {}
  for (const n of nodes) {
    positions[n.id] = { x: n.position.x, y: n.position.y }
  }
  return { steps, edges: outEdges, positions }
}
