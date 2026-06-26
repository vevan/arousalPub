import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  afterAssemblePrompts,
  insertSystemAfterLastUser,
} from '../../src/server/index.js'

describe('guidance-generate insertSystemAfterLastUser', () => {
  it('inserts system immediately after the last user message', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ]
    const out = insertSystemAfterLastUser(messages, 'guide')
    assert.deepEqual(out, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'system', content: 'guide' },
    ])
  })

  it('appends when no user message exists', () => {
    const messages = [{ role: 'system', content: 'only' }]
    const out = insertSystemAfterLastUser(messages, 'guide')
    assert.deepEqual(out, [
      { role: 'system', content: 'only' },
      { role: 'system', content: 'guide' },
    ])
  })
})

describe('guidance-generate afterAssemblePrompts', () => {
  it('injects guidance system after last user, not at tail', async () => {
    const messages = [
      { role: 'system', content: 'preset' },
      { role: 'user', content: 'hello' },
    ]
    const api = {
      applyPromptMacroPipeline: (text: string) => text,
      getUserPluginSettings: async () => ({ systemPrefix: 'G: ' }),
    }
    const out = await afterAssemblePrompts(
      {
        messages,
        macroContext: {},
        plugins: {
          'guidance-generate': { mode: 'send', guidanceText: 'be kind' },
        },
      },
      api,
    )
    assert.deepEqual(out, [
      { role: 'system', content: 'preset' },
      { role: 'user', content: 'hello' },
      { role: 'system', content: 'G:be kind' },
    ])
  })
})
