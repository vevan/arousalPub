export type AgentMode = 'off' | 'on'

export type AgentPipelineToolChoice = 'auto' | 'required' | 'none'

export type AgentPipelineAdvanceWhen =
  | 'required_tools_done'
  | 'offer_exhausted'
  | 'prose_committed'
  | 'required_writes_done'

/** if/else 谓词（generic · DOC/53 §17.10） */
export type AgentBranchPredicate =
  | { type: 'prev_tool_ok'; ok: boolean }
  | { type: 'prev_tool_code'; equals: string }
  | { type: 'prev_node_ok'; ok: boolean }

export type AgentPipelineStepConfig =
  | { kind: 'start' }
  | { kind: 'end' }
  | {
      kind: 'tool'
      toolName: string
      required?: boolean
      maxCalls?: number | 'unlimited' | null
      instruction?: string
      title?: string
      toolChoice?: AgentPipelineToolChoice
      advanceWhen?: AgentPipelineAdvanceWhen
    }
  | {
      kind: 'prose'
      instruction?: string
    }
  | {
      kind: 'branch'
      /** 稳定 id，供边引用 */
      id: string
      title?: string
      predicate?: AgentBranchPredicate
    }
  | {
      /** 插件 manifest.nodeTypes 注册的本地节点（非 LLM tool） */
      kind: 'node'
      id: string
      type: string
      pluginId: string
      title?: string
    }

export type AgentFlowEdgeConfig = {
  id: string
  source: string
  target: string
  sourceHandle?: 'then' | 'else' | string | null
  targetHandle?: string | null
}

/** 画布节点坐标（键 = stepNodeId）；自由布局，不强制自上而下 */
export type AgentFlowPositions = Record<string, { x: number; y: number }>

export type AgentSettingsDocument = {
  schemaVersion: 1
  agentMode: AgentMode
  /** 节点袋（下标≠执行序） */
  steps: AgentPipelineStepConfig[]
  /** 有向边 = 执行顺序真相 */
  edges?: AgentFlowEdgeConfig[]
  /** 自由布局坐标 */
  positions?: AgentFlowPositions
  updatedAt?: string
}

export type AgentToolCatalogEntry = {
  name: string
  /** 模型用说明；UI 优先 uiDescriptionKey */
  description: string
  phase: 'read' | 'write'
  maxCallsPerTurn: number
  source: 'core' | 'plugin'
  pluginId?: string
  uiTitleKey?: string
  uiDescriptionKey?: string
}

/** 插件 nodeTypes 目录（DOC/53 §6.3 · 非 tools） */
export type AgentNodeCatalogEntry = {
  type: string
  pluginId: string
  title?: string
  titleKey?: string
  description: string
  descriptionKey?: string
  version: number
}

/** 调色板分区（DOC/53 §17.9） */
export type AgentPaletteGroup = 'system' | 'control' | 'plugin'

export type AgentSettingsGetResponse = {
  settings: AgentSettingsDocument
  tools: AgentToolCatalogEntry[]
  nodes?: AgentNodeCatalogEntry[]
  /** true = 使用最小种子 start→prose→end（未落盘自定义图） */
  usingDefaultPipeline: boolean
  effectiveSteps: AgentPipelineStepConfig[]
  effectiveEdges?: AgentFlowEdgeConfig[]
  effectivePositions?: AgentFlowPositions
}
