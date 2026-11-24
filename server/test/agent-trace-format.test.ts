import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatProgressReasoningChunk,
  formatToolCallsReasoningChunk,
  formatToolResultReasoningChunk,
} from '../src/agent/agent-trace-format.js'

describe('agent-trace-format', () => {
  it('formats tool_calls chunk with name and args', () => {
    const chunk = formatToolCallsReasoningChunk(0, [
      { name: 'memory_search', arguments: '{"query":"hello"}' },
    ])
    assert.match(chunk, /step 1/)
    assert.match(chunk, /memory_search/)
    assert.match(chunk, /hello/)
  })

  it('formats tool_result with preview and ok status', () => {
    const chunk = formatToolResultReasoningChunk(0, {
      name: 'knowledge_search',
      arguments: '{}',
      result: 'hit A\nhit B',
      ok: true,
    })
    assert.match(chunk, /knowledge_search/)
    assert.match(chunk, /→ ok/)
    assert.match(chunk, /hit A/)
  })

  it('formatProgressReasoningChunk maps event types', () => {
    const calls = formatProgressReasoningChunk({
      type: 'tool_calls',
      stepIndex: 1,
      tools: [{ name: 'notes_list', arguments: '{}' }],
    })
    assert.ok(calls)
    assert.match(calls!, /notes_list/)

    const result = formatProgressReasoningChunk({
      type: 'tool_result',
      stepIndex: 1,
      tool: {
        name: 'notes_list',
        arguments: '{}',
        result: '[]',
        ok: true,
      },
    })
    assert.ok(result)
    assert.match(result!, /notes_list/)

    const finalChunk = formatProgressReasoningChunk({
      type: 'final',
      stepIndex: 1,
      contentChars: 10,
      finishReason: 'stop',
      usedTools: false,
    })
    assert.ok(finalChunk)
    assert.match(finalChunk!, /no tool_calls/)

    const start = formatProgressReasoningChunk({
      type: 'step_start',
      stepIndex: 0,
      toolsOffered: 2,
    })
    assert.ok(start)
    assert.match(start!, /tools offered: 2/)
  })
})
