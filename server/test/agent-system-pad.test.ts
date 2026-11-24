import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAgentToolsSystemPad,
  buildAgentToolsSystemPadFromPolicy,
  prependAgentToolsSystemPad,
} from '../src/agent/agent-system-pad.js'
import { buildDefaultAgentPipelinePolicy } from '../src/agent/agent-pipeline-policy.js'

describe('agent-system-pad', () => {
  it('lists tool names and pipeline steps', () => {
    const pad = buildAgentToolsSystemPad(['memory_search', 'knowledge_search'])
    assert.match(pad, /\[Agent tools\]/)
    assert.match(pad, /memory_search/)
    assert.match(pad, /knowledge_search/)
    assert.match(pad, /Pipeline steps/i)
  })

  it('documents write tools after prose when writeToolNames set', () => {
    const pad = buildAgentToolsSystemPad(
      ['memory_search', 'fixture_write_tool'],
      { writeToolNames: ['fixture_write_tool'] },
    )
    assert.match(pad, /Pipeline steps/i)
    assert.match(pad, /write:fixture_write_tool|Write · fixture_write_tool/)
    assert.match(pad, /fixture_write_tool/)
  })

  it('pad from policy matches fine-grained stages', () => {
    const policy = buildDefaultAgentPipelinePolicy({
      tools: [
        {
          name: 'lore_search',
          phase: 'read',
          maxCallsPerTurn: 1,
        },
        {
          name: 'memory_search',
          phase: 'read',
          maxCallsPerTurn: 1,
        },
        {
          name: 'fixture_read_tool',
          phase: 'read',
          maxCallsPerTurn: 1,
        },
        {
          name: 'fixture_write_tool',
          phase: 'write',
          maxCallsPerTurn: Number.POSITIVE_INFINITY,
        },
      ],
      requiredSearchToolNames: ['lore_search', 'memory_search'],
    })
    const pad = buildAgentToolsSystemPadFromPolicy(policy, [
      'lore_search',
      'memory_search',
      'fixture_read_tool',
      'fixture_write_tool',
    ])
    assert.match(pad, /tool:lore_search/)
    assert.match(pad, /tool:fixture_read_tool/)
    assert.match(pad, /write:fixture_write_tool/)
    assert.match(pad, /ONE STEP AT A TIME/i)
    const loreAt = pad.indexOf('tool:lore_search')
    const writeAt = pad.indexOf('write:fixture_write_tool')
    assert.ok(loreAt >= 0 && writeAt > loreAt)
  })

  it('prepends system pad once', () => {
    const once = prependAgentToolsSystemPad(
      [{ role: 'user', content: 'hi' }],
      ['memory_search'],
    )
    assert.equal(once[0]?.role, 'system')
    assert.match(String(once[0]?.content), /memory_search/)
    assert.equal(once[1]?.role, 'user')

    const twice = prependAgentToolsSystemPad(once, ['knowledge_search'])
    assert.equal(twice.filter((m) => m.role === 'system').length, 1)
    assert.match(String(twice[0]?.content), /knowledge_search/)
  })
})
