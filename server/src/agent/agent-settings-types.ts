/**
 * 全局 Agent 设置单文档（DOC/53 §16.9 / §17）。
 * 非多预设；会话稀疏覆盖同形字段。
 */

import type { PipelineAdvanceWhen, PipelineToolChoice } from './agent-pipeline-policy.js'
import type { AgentMode } from './agent-mode.js'
import type { AgentToolPhase } from './agent-prose-phase.js'

export const AGENT_SETTINGS_SCHEMA_VERSION = 1 as const

/** if/else 谓词（generic · DOC/53 §17.10） */
export type AgentBranchPredicate =
  | { type: 'prev_tool_ok'; ok: boolean }
  | { type: 'prev_tool_code'; equals: string }
  | { type: 'prev_node_ok'; ok: boolean }

/** 图节点（用户可编排；数组仅为序列化容器，下标≠执行序 · DOC/53 §17.11） */
export type AgentPipelineStepConfig =
  | { kind: 'start' }
  | { kind: 'end' }
  | {
      kind: 'tool'
      toolName: string
      required?: boolean
      /** 有限次数；省略或 null = 用工具默认；'unlimited' = 不限制 */
      maxCalls?: number | 'unlimited' | null
      instruction?: string
      title?: string
      toolChoice?: PipelineToolChoice
      advanceWhen?: PipelineAdvanceWhen
    }
  | {
      kind: 'prose'
      instruction?: string
    }
  | {
      kind: 'branch'
      id: string
      title?: string
      predicate?: AgentBranchPredicate
    }
  | {
      /** 插件 manifest.nodeTypes · 本地 runNode，非 LLM tool */
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

/** 画布节点坐标（键 = step 节点 id）；自由布局 */
export type AgentFlowPositions = Record<string, { x: number; y: number }>

export type AgentSettingsDocument = {
  schemaVersion: typeof AGENT_SETTINGS_SCHEMA_VERSION
  agentMode: AgentMode
  /** 节点袋；空 = 出站用最小种子 start→prose→end（非旧多工具默认链） */
  steps: AgentPipelineStepConfig[]
  /** 有向边 = 执行顺序与可达性真相 */
  edges?: AgentFlowEdgeConfig[]
  /** 自由布局坐标 */
  positions?: AgentFlowPositions
  updatedAt?: string
}

/** 设置页工具目录条目（generic） */
export type AgentToolCatalogEntry = {
  name: string
  /** 模型用说明（技术向）；UI 应优先 uiDescriptionKey */
  description: string
  phase: AgentToolPhase
  maxCallsPerTurn: number
  source: 'core' | 'plugin'
  pluginId?: string
  uiTitleKey?: string
  uiDescriptionKey?: string
}

/** 插件 nodeTypes 目录（非 tools） */
export type AgentNodeCatalogEntry = {
  type: string
  pluginId: string
  title?: string
  titleKey?: string
  description: string
  descriptionKey?: string
  version: number
}

export function emptyAgentSettingsDocument(): AgentSettingsDocument {
  return {
    schemaVersion: AGENT_SETTINGS_SCHEMA_VERSION,
    agentMode: 'off',
    steps: [],
  }
}

