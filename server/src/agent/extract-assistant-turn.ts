import type {
  AgentFinishReason,
  AgentToolCall,
  AssistantModelTurn,
} from './types.js'

function normalizeFinishReason(raw: unknown, hasToolCalls: boolean): AgentFinishReason {
  if (typeof raw === 'string') {
    const r = raw.trim().toLowerCase()
    if (r === 'tool_calls' || r === 'function_call') return 'tool_calls'
    if (r === 'stop' || r === 'end_turn') return 'stop'
    if (r === 'length' || r === 'max_tokens') return 'length'
  }
  if (hasToolCalls) return 'tool_calls'
  return 'stop'
}

function parseToolCalls(raw: unknown): AgentToolCall[] {
  if (!Array.isArray(raw)) return []
  const out: AgentToolCall[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const fn = o.function
    if (!fn || typeof fn !== 'object') continue
    const f = fn as Record<string, unknown>
    const name = typeof f.name === 'string' ? f.name.trim() : ''
    if (!id || !name) continue
    const args =
      typeof f.arguments === 'string'
        ? f.arguments
        : f.arguments != null
          ? JSON.stringify(f.arguments)
          : '{}'
    out.push({
      id,
      type: 'function',
      function: { name, arguments: args },
    })
  }
  return out
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const p = part as { type?: unknown; text?: unknown }
        if (p.type === 'text' && typeof p.text === 'string') return p.text
        return ''
      })
      .join('')
  }
  return ''
}

/** 从非流式 chat/completions JSON 提取一轮助手结果（含 tool_calls） */
export function extractAssistantModelTurn(json: unknown): AssistantModelTurn {
  if (!json || typeof json !== 'object') {
    return { content: '', toolCalls: [], finishReason: 'stop' }
  }
  const o = json as Record<string, unknown>
  const choices = o.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return { content: '', toolCalls: [], finishReason: 'stop' }
  }
  const first = choices[0]
  if (!first || typeof first !== 'object') {
    return { content: '', toolCalls: [], finishReason: 'stop' }
  }
  const choice = first as Record<string, unknown>
  const msg = choice.message
  let content = ''
  let toolCalls: AgentToolCall[] = []
  let reasoning: string | undefined
  if (msg && typeof msg === 'object') {
    const m = msg as Record<string, unknown>
    content = contentToString(m.content)
    toolCalls = parseToolCalls(m.tool_calls)
    const rs =
      typeof m.reasoning_content === 'string'
        ? m.reasoning_content
        : typeof m.reasoning === 'string'
          ? m.reasoning
          : typeof m.thinking === 'string'
            ? m.thinking
            : ''
    if (rs.trim()) reasoning = rs.trim()
  }
  const finishReason = normalizeFinishReason(choice.finish_reason, toolCalls.length > 0)
  return {
    content,
    reasoning,
    toolCalls,
    finishReason,
  }
}
