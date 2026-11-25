import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  clearAgentTools,
  extractAssistantModelTurn,
  fixtureEchoToolDefinition,
  isAgentModeOn,
  normalizeAgentMode,
  registerFixtureEchoTool,
  runAgentLoop,
  ToolCallAccumulator,
  clampAgentMaxSteps,
  type AgentMessage,
  type AssistantModelTurn,
} from '../src/agent/index.js'

afterEach(() => {
  clearAgentTools()
})

describe('agent-mode', () => {
  it('defaults to off', () => {
    assert.equal(normalizeAgentMode(undefined), 'off')
    assert.equal(isAgentModeOn(undefined), false)
    assert.equal(isAgentModeOn('on'), true)
  })
})

describe('clampAgentMaxSteps', () => {
  it('clamps to 1..32', () => {
    assert.equal(clampAgentMaxSteps(0), 1)
    assert.equal(clampAgentMaxSteps(12), 12)
    assert.equal(clampAgentMaxSteps(100), 32)
  })
})

describe('extractAssistantModelTurn', () => {
  it('reads tool_calls and finish_reason', () => {
    const turn = extractAssistantModelTurn({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'fixture_echo',
                  arguments: '{"text":"hi"}',
                },
              },
            ],
          },
        },
      ],
    })
    assert.equal(turn.finishReason, 'tool_calls')
    assert.equal(turn.toolCalls.length, 1)
    assert.equal(turn.toolCalls[0]?.function.name, 'fixture_echo')
    assert.equal(turn.content, '')
  })
})

describe('ToolCallAccumulator', () => {
  it('merges streaming deltas by index', () => {
    const acc = new ToolCallAccumulator()
    acc.applyDeltaToolCalls([
      {
        index: 0,
        id: 'call_1',
        type: 'function',
        function: { name: 'fixture_echo', arguments: '' },
      },
    ])
    acc.applyDeltaToolCalls([
      { index: 0, function: { arguments: '{"text":' } },
    ])
    acc.applyDeltaToolCalls([
      { index: 0, function: { arguments: '"hi"}' } },
    ])
    const calls = acc.toToolCalls()
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.id, 'call_1')
    assert.equal(calls[0]?.function.arguments, '{"text":"hi"}')
  })
})

describe('runAgentLoop', () => {
  const baseMessages: AgentMessage[] = [
    { role: 'user', content: 'ping' },
  ]

  it('echo tool then final text', async () => {
    registerFixtureEchoTool()
    let step = 0
    const result = await runAgentLoop({
      messages: baseMessages,
      tools: [fixtureEchoToolDefinition],
      maxSteps: 8,
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
                  arguments: '{"text":"ping"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        return {
          content: 'final-ok',
          toolCalls: [],
          finishReason: 'stop',
        }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.stopReason, 'final')
    assert.equal(result.content, 'final-ok')
    assert.equal(result.steps.length, 2)
    const toolMsg = result.messages.find((m) => m.role === 'tool')
    assert.ok(toolMsg)
    assert.match(String(toolMsg?.content), /"echo"/)
  })

  it('stops on maxSteps', async () => {
    registerFixtureEchoTool()
    const result = await runAgentLoop({
      messages: baseMessages,
      maxSteps: 2,
      complete: async (): Promise<AssistantModelTurn> => ({
        content: '',
        toolCalls: [
          {
            id: 'call_x',
            type: 'function',
            function: { name: 'fixture_echo', arguments: '{}' },
          },
        ],
        finishReason: 'tool_calls',
      }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.stopReason, 'max_steps')
    assert.equal(result.errorCode, 'max_steps')
    assert.equal(result.steps.length, 2)
  })

  it('cancels via AbortSignal', async () => {
    registerFixtureEchoTool()
    const ac = new AbortController()
    const result = await runAgentLoop({
      messages: baseMessages,
      signal: ac.signal,
      complete: async () => {
        ac.abort()
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'fixture_echo', arguments: '{}' },
            },
          ],
          finishReason: 'tool_calls',
        }
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.stopReason, 'cancelled')
  })

  it('tool_not_found is fed back and loop continues to max_steps', async () => {
    const result = await runAgentLoop({
      messages: baseMessages,
      maxSteps: 2,
      complete: async (): Promise<AssistantModelTurn> => ({
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'missing_tool', arguments: '{}' },
          },
        ],
        finishReason: 'tool_calls',
      }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.stopReason, 'max_steps')
    const toolMsg = result.messages.find((m) => m.role === 'tool')
    assert.ok(toolMsg)
    assert.match(String(toolMsg?.content), /tool_not_found/)
    assert.equal(result.steps[0]?.tools?.[0]?.ok, false)
    assert.equal(result.steps[0]?.tools?.[0]?.errorCode, 'tool_not_found')
  })

  it('resolveTools can hide tools on later steps', async () => {
    registerFixtureEchoTool()
    const toolsLens: Array<number | null> = []
    let step = 0
    const result = await runAgentLoop({
      messages: baseMessages,
      tools: [fixtureEchoToolDefinition],
      resolveTools: ({ stepIndex }) =>
        stepIndex === 0 ? [fixtureEchoToolDefinition] : undefined,
      maxSteps: 4,
      complete: async ({ tools }): Promise<AssistantModelTurn> => {
        toolsLens.push(tools == null ? null : tools.length)
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
                  arguments: '{"text":"a"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        return {
          content: 'done',
          toolCalls: [],
          finishReason: 'stop',
        }
      },
    })
    assert.equal(result.ok, true, result.errorDetail ?? result.errorCode)
    assert.deepEqual(toolsLens, [1, null])
  })

  it('requiredToolNames missing on last step → required_tools_missing', async () => {
    const result = await runAgentLoop({
      messages: baseMessages,
      maxSteps: 1,
      requiredToolNames: ['fixture_echo'],
      complete: async (): Promise<AssistantModelTurn> => ({
        content: 'skip',
        toolCalls: [],
        finishReason: 'stop',
      }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.stopReason, 'required_tools_missing')
    assert.equal(result.errorCode, 'required_tools_missing')
    assert.match(String(result.errorDetail), /fixture_echo/)
  })

  it('rejected write name in read step does not lock leaked prose', async () => {
    let step = 0
    const result = await runAgentLoop({
      messages: baseMessages,
      maxSteps: 4,
      requiredToolNames: ['must_search'],
      requiredWriteToolNames: ['fixture_write'],
      tools: [
        {
          type: 'function',
          function: {
            name: 'must_search',
            description: 'x',
            parameters: { type: 'object' },
          },
        },
      ],
      executeTool: async (name) => {
        if (name === 'must_search') {
          return { ok: true as const, content: '{"ok":true}' }
        }
        return {
          ok: false as const,
          code: 'pipeline_stage_rejected',
          detail: 'not write stage',
        }
      },
      complete: async (): Promise<AssistantModelTurn> => {
        step += 1
        if (step === 1) {
          return {
            content: 'leaked during search',
            toolCalls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'must_search', arguments: '{}' },
              },
              {
                id: 'c2',
                type: 'function',
                function: {
                  name: 'fixture_write',
                  arguments: '{}',
                },
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        if (step === 2) {
          return {
            content: 'real user-facing reply',
            toolCalls: [],
            finishReason: 'stop',
          }
        }
        if (step === 3) {
          return {
            content: 'meta',
            toolCalls: [
              {
                id: 'c3',
                type: 'function',
                function: {
                  name: 'fixture_write',
                  arguments: '{}',
                },
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        return { content: 'done', toolCalls: [], finishReason: 'stop' }
      },
    })
    // write 被拒不得锁泄漏文；正文应为正式 prose
    assert.equal(result.content, 'real user-facing reply')
  })

  it('failed required tool call does not count as satisfied', async () => {
    let step = 0
    const result = await runAgentLoop({
      messages: baseMessages,
      maxSteps: 2,
      requiredToolNames: ['must_search'],
      tools: [
        {
          type: 'function',
          function: {
            name: 'must_search',
            description: 'x',
            parameters: { type: 'object' },
          },
        },
      ],
      executeTool: async () => ({
        ok: false as const,
        code: 'tool_failed',
        detail: 'boom',
      }),
      complete: async (): Promise<AssistantModelTurn> => {
        step += 1
        if (step === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'must_search', arguments: '{}' },
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        return {
          content: 'fake done without success',
          toolCalls: [],
          finishReason: 'stop',
        }
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.stopReason, 'required_tools_missing')
    assert.match(String(result.errorDetail), /must_search/)
  })

  it('nudges when requiredWriteToolNames missing after prose then finals', async () => {
    registerFixtureEchoTool()
    let step = 0
    const result = await runAgentLoop({
      messages: baseMessages,
      tools: [fixtureEchoToolDefinition],
      requiredWriteToolNames: ['fixture_echo'],
      complete: async (): Promise<AssistantModelTurn> => {
        step += 1
        if (step === 1) {
          return {
            content: 'user-facing reply',
            toolCalls: [],
            finishReason: 'stop',
          }
        }
        if (step === 2) {
          return {
            // 弱模型常在 write 步输出 meta 短句；不得覆盖已锁定正文
            content: 'The scene has been recorded and the tracker updated.',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'fixture_echo',
                  arguments: '{"text":"patch"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        return {
          content: 'another meta line',
          toolCalls: [],
          finishReason: 'stop',
        }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.content, 'user-facing reply')
    assert.ok(step >= 3)
    assert.ok(
      result.steps.some((s) => s.toolNames?.includes('fixture_echo')),
    )
    const nudge = result.messages.find(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('write/mutate'),
    )
    assert.ok(nudge)
  })

  it('nudges when requiredToolNames missing then finals', async () => {
    registerFixtureEchoTool()
    let step = 0
    const result = await runAgentLoop({
      messages: baseMessages,
      tools: [fixtureEchoToolDefinition],
      requiredToolNames: ['fixture_echo'],
      complete: async (): Promise<AssistantModelTurn> => {
        step += 1
        if (step === 1) {
          return {
            content: 'skip tools',
            toolCalls: [],
            finishReason: 'stop',
          }
        }
        if (step === 2) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'fixture_echo',
                  arguments: '{"text":"x"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        return {
          content: 'done',
          toolCalls: [],
          finishReason: 'stop',
        }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.content, 'done')
    assert.ok(step >= 3)
    assert.ok(
      result.steps.some((s) => s.toolNames?.includes('fixture_echo')),
    )
  })
})
