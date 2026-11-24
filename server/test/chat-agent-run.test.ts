import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  agentMessagesToUpstream,
  chatMessagesToAgentMessages,
  clearAgentTools,
  formatAssistantContentSse,
  registerFixtureEchoTool,
  runChatAgentLoop,
  fixtureEchoToolDefinition,
} from '../src/agent/index.js'
import type { AssistantModelTurn } from '../src/agent/types.js'

afterEach(() => {
  clearAgentTools()
})

describe('chatMessagesToAgentMessages', () => {
  it('maps roles and content', () => {
    const out = chatMessagesToAgentMessages([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ])
    assert.deepEqual(out, [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ])
  })
})

describe('agentMessagesToUpstream', () => {
  it('serializes tool round-trip shape', () => {
    const rows = agentMessagesToUpstream([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'fixture_echo', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    ])
    assert.equal(rows[0]?.role, 'assistant')
    assert.ok(Array.isArray((rows[0] as { tool_calls?: unknown }).tool_calls))
    assert.equal(rows[1]?.role, 'tool')
    assert.equal((rows[1] as { tool_call_id?: string }).tool_call_id, 'c1')
  })
})

describe('formatAssistantContentSse', () => {
  it('emits content delta and DONE', () => {
    const s = formatAssistantContentSse('hello')
    assert.match(s, /"content":"hello"/)
    assert.match(s, /\[DONE\]/)
  })
})

describe('runChatAgentLoop', () => {
  it('runs fixture tool then final via injected complete', async () => {
    registerFixtureEchoTool()
    let step = 0
    const result = await runChatAgentLoop({
      messages: [{ role: 'user', content: 'hi' }],
      basePayload: { model: 'test' },
      url: 'http://127.0.0.1/unused',
      apiKey: 'k',
      tools: [fixtureEchoToolDefinition],
      complete: async (): Promise<AssistantModelTurn> => {
        step += 1
        if (step === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'fixture_echo',
                  arguments: '{"text":"hi"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        return { content: 'done', toolCalls: [], finishReason: 'stop' }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.content, 'done')
    assert.equal(result.steps.length, 2)
  })
})
