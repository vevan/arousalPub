import {
  AGENT_AUDIT_ARGS_PREVIEW,
  AGENT_AUDIT_RESULT_PREVIEW,
  previewAgentToolText,
} from './agent-limits.js'
import type { AgentLoopProgressEvent } from './agent-loop.js'
import type { AgentLoopToolTrace } from './types.js'

export function formatStepStartReasoningChunk(
  stepIndex: number,
  toolsOffered: number,
): string {
  return `\n### Agent · step ${stepIndex + 1} · start\n\ntools offered: ${toolsOffered}\n`
}

export function formatFinalReasoningChunk(
  stepIndex: number,
  finishReason: string,
  usedTools: boolean,
): string {
  const note = usedTools
    ? 'final answer after tools'
    : 'no tool_calls · model answered directly'
  return `\n### Agent · step ${stepIndex + 1} · final (${finishReason})\n\n${note}\n`
}

export function formatToolCallsReasoningChunk(
  stepIndex: number,
  tools: AgentLoopToolTrace[],
): string {
  const lines = [`\n### Agent · step ${stepIndex + 1} · tool_calls\n`]
  for (const t of tools) {
    lines.push(`- **${t.name}**`)
    lines.push('```json')
    lines.push(previewAgentToolText(t.arguments || '{}', AGENT_AUDIT_ARGS_PREVIEW))
    lines.push('```')
  }
  return `${lines.join('\n')}\n`
}

export function formatToolResultReasoningChunk(
  stepIndex: number,
  tool: AgentLoopToolTrace,
): string {
  const status = tool.ok === false ? 'error' : 'ok'
  const lines = [
    `\n### Agent · step ${stepIndex + 1} · \`${tool.name}\` → ${status}\n`,
  ]
  if (tool.ok === false && tool.errorCode) {
    lines.push(`code: \`${tool.errorCode}\``)
  }
  lines.push('```')
  lines.push(
    previewAgentToolText(tool.result || '', AGENT_AUDIT_RESULT_PREVIEW),
  )
  lines.push('```')
  return `${lines.join('\n')}\n`
}

export function formatProgressReasoningChunk(
  ev: AgentLoopProgressEvent,
): string | null {
  if (ev.type === 'step_start') {
    return formatStepStartReasoningChunk(ev.stepIndex, ev.toolsOffered)
  }
  if (ev.type === 'tool_calls') {
    return formatToolCallsReasoningChunk(ev.stepIndex, ev.tools)
  }
  if (ev.type === 'tool_result') {
    return formatToolResultReasoningChunk(ev.stepIndex, ev.tool)
  }
  if (ev.type === 'final') {
    return formatFinalReasoningChunk(
      ev.stepIndex,
      ev.finishReason,
      ev.usedTools,
    )
  }
  return null
}

/** OpenAI 兼容 SSE：把文本追加到思维链 */
export function formatAssistantReasoningSse(reasoningChunk: string): string {
  if (!reasoningChunk) return ''
  return `data: ${JSON.stringify({
    choices: [{ delta: { reasoning_content: reasoningChunk } }],
  })}\n\n`
}

export function formatAssistantContentDeltaSse(contentChunk: string): string {
  if (!contentChunk) return ''
  return `data: ${JSON.stringify({
    choices: [{ delta: { content: contentChunk } }],
  })}\n\n`
}
