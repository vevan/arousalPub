import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAgentToolsSystemPad,
  prependAgentToolsSystemPad,
} from '../src/agent/agent-system-pad.js'

describe('agent-system-pad', () => {
  it('lists tool names', () => {
    const pad = buildAgentToolsSystemPad(['memory_search', 'knowledge_search'])
    assert.match(pad, /\[Agent tools\]/)
    assert.match(pad, /memory_search/)
    assert.match(pad, /knowledge_search/)
    assert.match(pad, /call every listed tool/i)
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
