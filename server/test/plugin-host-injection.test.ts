import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  additionToInjections,
  applyPluginsAfterAssemblePrompts,
  countPluginAssembleAdditionTokens,
  estimatePluginsAfterAssembleTokenReserve,
  type PluginAssembleAdditionCache,
} from '../src/plugin-host.js'
import { normalizePostUserInjectionOrderHostPolicy } from '../src/shared/post-user-injection-order.js'
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
  it('merges injection descriptor after last user when history span provided', async () => {
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
          id: 'fixture-plugin-high',
          order: 10,
          module: {
            resolveAfterAssemblePromptsAddition: async () => [
              {
                role: 'system' as const,
                content: 'tracker',
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 10 },
              },
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
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 10 },
              },
              {
                role: 'system' as const,
                content: 'tracker',
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 500 },
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

  it('merges low injectionOrder before high injectionOrder across plugins', async () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
    ]
    const runtime = {
      plugins: [
        {
          id: 'fixture-plugin-low',
          order: 10,
          module: {
            resolveAfterAssemblePromptsAddition: async () => [
              {
                role: 'system' as const,
                content: 'guide',
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 10 },
              },
            ],
          },
        },
        {
          id: 'fixture-plugin-high',
          order: 70,
          module: {
            resolveAfterAssemblePromptsAddition: async () => [
              {
                role: 'system' as const,
                content: 'tracker',
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 500 },
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

  it('interleaves afterUserInput between low- and high-order plugins', async () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
      { role: 'system' as const, content: 'GROUP-CHAT-RULE' },
    ]
    const runtime = {
      plugins: [
        {
          id: 'fixture-plugin-low',
          order: 10,
          module: {
            resolveAfterAssemblePromptsAddition: async () => [
              {
                role: 'system' as const,
                content: 'guide',
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 10 },
              },
            ],
          },
        },
        {
          id: 'fixture-plugin-high',
          order: 70,
          module: {
            resolveAfterAssemblePromptsAddition: async () => [
              {
                role: 'system' as const,
                content: 'tracker',
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 500 },
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
      afterUserInput: { content: 'GROUP-CHAT-RULE', role: 'system' },
    })

    assert.deepEqual(
      out.map((m) => m.content),
      ['main', 'hello', 'guide', 'GROUP-CHAT-RULE', 'tracker'],
    )
  })

  it('interleaves macro-expanded afterUserInput between low- and high-order plugins', async () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
      { role: 'system' as const, content: 'EXPANDED-GROUP-RULE' },
    ]
    const runtime = {
      plugins: [
        {
          id: 'fixture-plugin-low',
          order: 10,
          module: {
            resolveAfterAssemblePromptsAddition: async () => [
              {
                role: 'system' as const,
                content: 'guide',
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 10 },
              },
            ],
          },
        },
        {
          id: 'fixture-plugin-high',
          order: 70,
          module: {
            resolveAfterAssemblePromptsAddition: async () => [
              {
                role: 'system' as const,
                content: 'tracker',
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 500 },
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
      afterUserInput: {
        content: 'EXPANDED-GROUP-RULE',
        role: 'system',
      },
    })

    assert.deepEqual(
      out.map((m) => m.content),
      ['main', 'hello', 'guide', 'EXPANDED-GROUP-RULE', 'tracker'],
    )
  })

  it('merges revise assistant 11 and system 12 after last user', async () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
    ]
    const runtime = {
      plugins: [
        {
          id: 'fixture-plugin-low',
          order: 10,
          module: {
            resolveAfterAssemblePromptsAddition: async () => [
              {
                role: 'assistant' as const,
                content: 'draft',
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 11 },
              },
              {
                role: 'system' as const,
                content: 'revise guide',
                position: { kind: 'chat' as const, depth: 0, injectionOrder: 12 },
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
      out.map((m) => `${m.role}:${m.content}`),
      ['system:main', 'user:hello', 'assistant:draft', 'system:revise guide'],
    )
  })
})

describe('plugin assemble additionCache and token reserve', () => {
  it('reuses additionCache between estimate and apply', async () => {
    let hookCalls = 0
    const cache: PluginAssembleAdditionCache = new Map()
    const runtime = {
      plugins: [
        {
          id: 'demo',
          order: 1,
          module: {
            resolveAfterAssemblePromptsAddition: async () => {
              hookCalls += 1
              return [
                {
                  role: 'system' as const,
                  content: 'guide',
                  position: { kind: 'chat' as const, depth: 0, injectionOrder: 10 },
                },
              ]
            },
          },
        },
      ] as LoadedServerPlugin[],
      api: {} as PluginServerHostApi,
    }

    const ctx = {
      messages: [{ role: 'user' as const, content: 'hi' }],
      macroContext: {},
      additionCache: cache,
      assembleRuntime: runtime,
    }

    await estimatePluginsAfterAssembleTokenReserve(ctx)
    assert.equal(hookCalls, 1)
    assert.equal(cache.size, 1)

    await applyPluginsAfterAssemblePrompts(ctx)
    assert.equal(hookCalls, 1)
  })

  it('counts descriptor additions for token reserve', () => {
    const descriptorTokens = countPluginAssembleAdditionTokens({
      kind: 'injections',
      injections: [
        {
          role: 'system',
          content: 'abc',
          position: { kind: 'chat', depth: 0, injectionOrder: 1 },
        },
      ],
    })
    assert.ok(descriptorTokens > 0)
  })
})

describe('additionToInjections', () => {
  it('fills missing injectionOrder from hostPolicy.default', () => {
    const hostPolicy = normalizePostUserInjectionOrderHostPolicy({ default: 77 })
    const injections = additionToInjections(
      {
        kind: 'injections',
        injections: [
          {
            role: 'system',
            content: 'x',
            position: { kind: 'chat', depth: 0 },
          },
        ],
      },
      hostPolicy,
    )
    assert.equal(injections[0]!.position.injectionOrder, 77)
  })

  it('preserves explicit injectionOrder on descriptors', () => {
    const hostPolicy = normalizePostUserInjectionOrderHostPolicy({ default: 77 })
    const injections = additionToInjections(
      {
        kind: 'injections',
        injections: [
          {
            role: 'system',
            content: 'x',
            position: { kind: 'chat', depth: 0, injectionOrder: 5 },
          },
        ],
      },
      hostPolicy,
    )
    assert.equal(injections[0]!.position.injectionOrder, 5)
  })
})
