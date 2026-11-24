import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { accumulateAssistantTurnFromSse } from '../src/agent/accumulate-assistant-from-sse.js'
import { parseSseDataLine } from '../src/sse-assistant.js'

describe('parseSseDataLine tool_calls', () => {
  it('exposes toolCallsDelta and finishReason', () => {
    const d = parseSseDataLine(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"fixture_echo","arguments":""}}]},"finish_reason":null}]}',
    )
    assert.ok(d?.toolCallsDelta)
    const done = parseSseDataLine(
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    )
    assert.equal(done?.finishReason, 'tool_calls')
  })
})

describe('accumulateAssistantTurnFromSse', () => {
  it('builds tool_calls from chunked SSE', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"fixture_echo","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"text\\":\\"x\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        for (const line of lines) controller.enqueue(enc.encode(line))
        controller.close()
      },
    })
    const turn = await accumulateAssistantTurnFromSse(stream)
    assert.equal(turn.finishReason, 'tool_calls')
    assert.equal(turn.toolCalls.length, 1)
    assert.equal(turn.toolCalls[0]?.function.name, 'fixture_echo')
    assert.equal(turn.toolCalls[0]?.function.arguments, '{"text":"x"}')
  })
})
