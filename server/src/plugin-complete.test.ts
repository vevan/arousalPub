import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runPluginComplete } from './plugin-complete.js'

describe('runPluginComplete', () => {
  it('rejects empty messages without upstream call', async () => {
    const r = await runPluginComplete({
      apiConfigId: 'any',
      messages: [],
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'messages_empty')
  })

  it('rejects invalid message roles', async () => {
    const r = await runPluginComplete({
      apiConfigId: 'any',
      messages: [{ role: 'tool' as 'user', content: 'x' }],
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'messages_invalid')
  })

  it('rejects stream requests', async () => {
    const r = await runPluginComplete({
      apiConfigId: 'any',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'stream_not_supported')
  })
})
