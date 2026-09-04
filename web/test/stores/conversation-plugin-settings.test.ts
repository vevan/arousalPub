import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useConversationPluginSettingsStore } from '../../src/stores/conversation-plugin-settings.js'

describe('useConversationPluginSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('subscribePlugin receives the conversation id that changed', () => {
    const store = useConversationPluginSettingsStore()
    const seen: Array<{ conversationId: string; settings: Record<string, unknown> }> = []
    store.subscribePlugin('fixture-plugin-a', (conversationId, settings) => {
      seen.push({ conversationId, settings })
    })
    store.setBag('conv-old', 'fixture-plugin-a', { seed: 1 })
    store.setBag('conv-new', 'fixture-plugin-a', { seed: 2 })
    assert.deepEqual(seen, [
      { conversationId: 'conv-old', settings: { seed: 1 } },
      { conversationId: 'conv-new', settings: { seed: 2 } },
    ])
  })

  it('clearAll drops plugin-wide subscribers', () => {
    const store = useConversationPluginSettingsStore()
    let calls = 0
    store.subscribePlugin('fixture-plugin-a', () => {
      calls += 1
    })
    store.clearAll()
    store.setBag('conv-1', 'fixture-plugin-a', { seed: 1 })
    assert.equal(calls, 0)
  })
})
