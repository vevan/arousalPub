import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appendAssistantThenGuidanceSystem,
  insertSystemAfterLastUser,
  parsePayload,
  resolveAfterAssemblePromptsAddition,
} from '../../src/server/index.js'
import { mergePluginPromptInjectionsIntoMessages } from '../../../../server/src/plugin-prompt-injection-merge.js'

describe('guidance-generate parsePayload', () => {
  it('accepts revise mode with assistantText', () => {
    const parsed = parsePayload({
      mode: 'revise',
      guidanceText: ' soften tone ',
      assistantText: ' hello ',
    })
    assert.deepEqual(parsed, {
      mode: 'revise',
      guidanceText: 'soften tone',
      assistantText: 'hello',
    })
  })

  it('rejects revise without assistantText', () => {
    assert.equal(
      parsePayload({ mode: 'revise', guidanceText: 'x' }),
      null,
    )
  })
})

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

describe('guidance-generate appendAssistantThenGuidanceSystem', () => {
  it('appends assistant draft then guidance system at tail', () => {
    const messages = [
      { role: 'user', content: 'u1' },
    ]
    const out = appendAssistantThenGuidanceSystem(
      messages,
      'draft reply',
      'revise: be kind',
    )
    assert.deepEqual(out, [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'draft reply' },
      { role: 'system', content: 'revise: be kind' },
    ])
  })
})

describe('guidance-generate resolveAfterAssemblePromptsAddition', () => {
  const api = {
    applyPromptMacroPipeline: (text: string) => text,
    getUserPluginSettings: async (pluginId: string) =>
      pluginId === 'guidance-generate'
        ? { systemPrefix: 'G: ', reviseSystemPrefix: 'R: ' }
        : null,
  }

  it('returns depth 0 injectionOrder 10 system for send mode', async () => {
    const injections = await resolveAfterAssemblePromptsAddition(
      {
        pluginId: 'guidance-generate',
        macroContext: {},
        plugins: {
          'guidance-generate': { mode: 'send', guidanceText: 'be kind' },
        },
      },
      api,
    )
    assert.deepEqual(injections, [
      {
        role: 'system',
        content: 'G:be kind',
        position: {
          kind: 'chat',
          depth: 0,
          injectionOrder: 10,
        },
      },
    ])
  })

  it('send mode merges after last user via host order semantics', async () => {
    const base = [
      { role: 'system' as const, content: 'preset' },
      { role: 'user' as const, content: 'hello' },
    ]
    const injections = await resolveAfterAssemblePromptsAddition(
      {
        pluginId: 'guidance-generate',
        macroContext: {},
        plugins: {
          'guidance-generate': { mode: 'send', guidanceText: 'be kind' },
        },
      },
      api,
    )
    const { messages } = mergePluginPromptInjectionsIntoMessages(
      base,
      injections!,
    )
    assert.deepEqual(
      messages.map((m) => m.content),
      ['preset', 'hello', 'G:be kind'],
    )
  })

  it('revise returns assistant 11 + system 12 descriptors', async () => {
    const injections = await resolveAfterAssemblePromptsAddition(
      {
        pluginId: 'guidance-generate',
        macroContext: {},
        plugins: {
          'guidance-generate': {
            mode: 'revise',
            guidanceText: 'soften',
            assistantText: 'Rough reply',
          },
        },
      },
      api,
    )
    assert.deepEqual(injections, [
      {
        role: 'assistant',
        content: 'Rough reply',
        position: {
          kind: 'chat',
          depth: 0,
          injectionOrder: 11,
        },
      },
      {
        role: 'system',
        content: 'R:soften',
        position: {
          kind: 'chat',
          depth: 0,
          injectionOrder: 12,
        },
      },
    ])
  })

  it('revise merges assistant draft then guidance system after last user', async () => {
    const base = [
      { role: 'system' as const, content: 'preset' },
      { role: 'user' as const, content: 'hello' },
    ]
    const injections = await resolveAfterAssemblePromptsAddition(
      {
        pluginId: 'guidance-generate',
        macroContext: {},
        plugins: {
          'guidance-generate': {
            mode: 'revise',
            guidanceText: 'soften',
            assistantText: 'Rough reply',
          },
        },
      },
      api,
    )
    const { messages } = mergePluginPromptInjectionsIntoMessages(
      base,
      injections!,
    )
    assert.deepEqual(
      messages.map((m) => m.content),
      ['preset', 'hello', 'Rough reply', 'R:soften'],
    )
  })
})
