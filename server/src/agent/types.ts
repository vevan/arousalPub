/** Agent loop / tools 消息与结果（DOC/devNotes/53） */

export type AgentRole = 'system' | 'user' | 'assistant' | 'tool'

export interface AgentToolCallFunction {
  name: string
  /** JSON 字符串（与 OpenAI 兼容） */
  arguments: string
}

export interface AgentToolCall {
  id: string
  type: 'function'
  function: AgentToolCallFunction
}

/** 环内消息；content 在 assistant+tool_calls 时可为 null/省略 */
export interface AgentMessage {
  role: AgentRole
  content?: string | null
  name?: string
  tool_calls?: AgentToolCall[]
  tool_call_id?: string
}

/** 出站 OpenAI tools[] 单项 */
export interface AgentToolDefinition {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export type AgentFinishReason = 'stop' | 'tool_calls' | 'length' | 'other'

export interface AssistantModelTurn {
  content: string
  reasoning?: string
  toolCalls: AgentToolCall[]
  finishReason: AgentFinishReason
}

export type AgentLoopStopReason =
  | 'final'
  | 'max_steps'
  | 'cancelled'
  | 'tool_error'
  | 'complete_error'
  | 'required_tools_missing'

export interface AgentLoopToolTrace {
  name: string
  arguments: string
  result?: string
  ok?: boolean
  errorCode?: string
}

export interface AgentLoopStepTrace {
  stepIndex: number
  finishReason: AgentFinishReason
  toolNames: string[]
  contentChars: number
  /** 本步工具调用明细（含参数/结果摘要，供思维链与审计） */
  tools?: AgentLoopToolTrace[]
}

export interface AgentLoopResult {
  ok: boolean
  /** 最终助手正文（无 tool_calls 的一轮） */
  content: string
  reasoning?: string
  messages: AgentMessage[]
  steps: AgentLoopStepTrace[]
  stopReason: AgentLoopStopReason
  errorCode?: string
  errorDetail?: string
}

export const AGENT_MAX_STEPS_DEFAULT = 12
export const AGENT_MAX_STEPS_CLAMP = 32

export function clampAgentMaxSteps(n: number | undefined): number {
  const raw = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : AGENT_MAX_STEPS_DEFAULT
  if (raw < 1) return 1
  if (raw > AGENT_MAX_STEPS_CLAMP) return AGENT_MAX_STEPS_CLAMP
  return raw
}
