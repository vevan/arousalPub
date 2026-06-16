import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveAfterAssemblePromptsAddition } from '../../dist/server.mjs'

describe('trace-keeper injection vs body.plugins', () => {
  it('injects tracker system regardless of unrelated plugin payloads in ctx.plugins', async () => {
    const api = {
      getUserPluginSettings: async () => ({}),
      getConversationPluginSettings: async () => ({}),
      readConversationTurnsTail: async () => [],
    }
    const addition = await resolveAfterAssemblePromptsAddition(
      {
        pluginId: 'trace-keeper',
        macroContext: { conversationId: 'c1' },
        plugins: {
          'some-other-plugin': { foo: 'bar' },
        },
      },
      api,
    )
    assert.ok(addition?.length === 1)
    assert.match(addition![0]!.content, /ex-trace-keeper/i)
  })
})
