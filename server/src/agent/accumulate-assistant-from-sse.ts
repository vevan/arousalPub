import { parseSseDataLine } from '../sse-assistant.js'
import { ToolCallAccumulator } from './tool-call-accumulator.js'
import type { AssistantModelTurn, AgentFinishReason } from './types.js'

function mapFinish(raw: string | undefined, hasTools: boolean): AgentFinishReason {
  if (raw) {
    const r = raw.trim().toLowerCase()
    if (r === 'tool_calls' || r === 'function_call') return 'tool_calls'
    if (r === 'stop' || r === 'end_turn') return 'stop'
    if (r === 'length' || r === 'max_tokens') return 'length'
  }
  return hasTools ? 'tool_calls' : 'stop'
}

export type AssistantSseDelta = {
  text?: string
  reasoning?: string
  toolCallsDelta?: unknown
  finishReason?: string
}

/** 将上游 SSE 累成一轮 AssistantModelTurn（含 tool_calls） */
export async function accumulateAssistantTurnFromSse(
  body: ReadableStream<Uint8Array>,
  opts?: {
    signal?: AbortSignal
    onDelta?: (d: AssistantSseDelta) => void
  },
): Promise<AssistantModelTurn> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finishReasonRaw: string | undefined
  const tools = new ToolCallAccumulator()
  const onDelta = opts?.onDelta

  const handleLine = (line: string): void => {
    const d = parseSseDataLine(line)
    if (!d) return
    if (d.text) content += d.text
    if (d.reasoning) reasoning += d.reasoning
    if (d.toolCallsDelta !== undefined) tools.applyDeltaToolCalls(d.toolCallsDelta)
    if (d.finishReason) finishReasonRaw = d.finishReason
    onDelta?.({
      ...(d.text ? { text: d.text } : {}),
      ...(d.reasoning ? { reasoning: d.reasoning } : {}),
      ...(d.toolCallsDelta !== undefined
        ? { toolCallsDelta: d.toolCallsDelta }
        : {}),
      ...(d.finishReason ? { finishReason: d.finishReason } : {}),
    })
  }

  try {
    while (true) {
      if (opts?.signal?.aborted) {
        try {
          await reader.cancel()
        } catch {
          /* ignore */
        }
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const line of parts) handleLine(line)
    }
    if (buffer.trim()) handleLine(buffer)
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }

  const toolCalls = tools.toToolCalls()
  const r = reasoning.trim()
  return {
    content,
    reasoning: r || undefined,
    toolCalls,
    finishReason: mapFinish(finishReasonRaw, toolCalls.length > 0),
  }
}
