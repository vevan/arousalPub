import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyPluginsAfterAssemblePrompts,
  type PluginAssembleAdditionCache,
} from '../src/plugin-host.js'
import { resolvePluginInjectionSpan } from '../src/plugin-prompt-injection-merge.js'
import type { LoadedServerPlugin, PluginServerHostApi } from '../src/plugin-system/types.js'

describe('resolvePluginInjectionSpan', () => {
  it('finds contiguous history block in assembled messages', () => {
    const history = [
      { role: 'user' as const, content: 'u1' },
      { role: 'assistant' as const, content: 'a1' },
    ]
    const messages = [
      { role: 'system' as const, content: 'main' },
      ...history,
      { role: 'user' as const, content: 'current' },
    ]
    const span = resolvePluginInjectionSpan(messages, history)
    assert.deepEqual(span, { historyStart: 1, historyEnd: 3 })
  })
})

describe('applyPluginsAfterAssemblePrompts', () => {
  it('merges legacy addition after last user when history span provided', async () => {
    const history = [
      { role: 'user' as const, content: 'u1' },
      { role: 'assistant' as const, content: 'a1' },
    ]
    const base = [
      { role: 'system' as const, content: 'main' },
      ...history,
      { role: 'user' as const, content: 'current' },
    ]

    const cache: PluginAssembleAdditionCache = new Map()
    const runtime = {
      plugins: [
        {
          id: 'trace-keeper',
          order: 10,
          module: {
            resolveAfterAssemblePromptsAddition: async () => [
              { role: 'system' as const, content: 'tracker' },
            ],
          },
        },
      ] as LoadedServerPlugin[],
      api: {} as PluginServerHostApi,
    }

    const out = await applyPluginsAfterAssemblePrompts({
      messages: base,
      macroContext: { conversationId: 'abcd1234' },
      trimmedHistoryMessages: history,
      additionCache: cache,
      assembleRuntime: runtime,
    })

    assert.deepEqual(
      out.map((m) => m.content),
      ['main', 'u1', 'a1', 'current', 'tracker'],
    )
  })

  it('merges explicit PluginPromptInjection descriptors', async () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
    ]
    const runtime = {
      plugins: [
        {
          id: 'demo',
          order: 1,
          module: {
            resolveAfterAssemblePromptsAddition: async () => [
              {
                role: 'system' as const,
                content: 'guide',
                position: { kind: 'chat' as const, depth: 0, order: 1 },
              },
              {
                role: 'system' as const,
                content: 'tracker',
                position: { kind: 'chat' as const, depth: 0, order: 999 },
              },
            ],
          },
        },
      ] as LoadedServerPlugin[],
      api: {} as PluginServerHostApi,
    }

    const out = await applyPluginsAfterAssemblePrompts({
      messages: base,
      macroContext: {},
      assembleRuntime: runtime,
    })

    assert.deepEqual(
      out.map((m) => m.content),
      ['main', 'hello', 'guide', 'tracker'],
    )
  })
})
