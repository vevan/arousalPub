/**
 * 生效 Agent 模式 / 流水线：会话稀疏覆盖 ∪ 全局单文档。
 */

import type { AgentMode } from './agent-mode.js'
import { normalizeAgentMode } from './agent-mode.js'
import { readAgentSettingsDocument } from './agent-settings-file.js'
import type {
  AgentFlowEdgeConfig,
  AgentPipelineStepConfig,
} from './agent-settings-types.js'
import type { AgentPipelinePolicy } from './agent-pipeline-policy.js'
import { compileAgentPipelinePolicyFromSteps } from './agent-settings-compile.js'
import type { CompileToolMeta } from './agent-settings-compile.js'
import { seedMinimalAgentGraph } from './agent-graph.js'

export type AgentModeSource = 'session' | 'global'

export function conversationHasAgentModeOverride(
  index: { agentMode?: unknown } | null | undefined,
): boolean {
  if (!index || typeof index !== 'object') return false
  return Object.prototype.hasOwnProperty.call(index, 'agentMode')
}

export function resolveEffectiveAgentMode(
  conversationIndex: { agentMode?: unknown } | null | undefined,
  globalMode: AgentMode,
): { mode: AgentMode; source: AgentModeSource } {
  if (conversationHasAgentModeOverride(conversationIndex)) {
    const raw = conversationIndex!.agentMode
    if (raw === null || raw === undefined) {
      return { mode: globalMode, source: 'global' }
    }
    return { mode: normalizeAgentMode(raw), source: 'session' }
  }
  return { mode: globalMode, source: 'global' }
}

export async function loadEffectiveAgentMode(
  conversationIndex: { agentMode?: unknown } | null | undefined,
  userId?: string,
): Promise<{ mode: AgentMode; source: AgentModeSource }> {
  const global = await readAgentSettingsDocument(userId)
  return resolveEffectiveAgentMode(conversationIndex, global.agentMode)
}

export function resolveEffectivePipelineSteps(
  conversationSteps: AgentPipelineStepConfig[] | null | undefined,
  globalSteps: AgentPipelineStepConfig[],
): AgentPipelineStepConfig[] {
  if (Array.isArray(conversationSteps) && conversationSteps.length > 0) {
    return conversationSteps
  }
  return globalSteps
}

/**
 * 空图 → 最小种子；非空图须已通过 validateAgentGraph（调用方负责）。
 * 禁止回退旧 buildDefaultAgentPipelinePolicy 多工具链。
 */
export function buildPolicyFromEffectiveSteps(
  steps: AgentPipelineStepConfig[],
  toolMeta: CompileToolMeta[],
  edges?: AgentFlowEdgeConfig[],
): AgentPipelinePolicy {
  if (steps.length === 0) {
    const seed = seedMinimalAgentGraph()
    return compileAgentPipelinePolicyFromSteps(
      seed.steps,
      toolMeta,
      seed.edges,
    )
  }
  return compileAgentPipelinePolicyFromSteps(steps, toolMeta, edges)
}
