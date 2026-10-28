import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appendAssistantThenGuidanceSystem,
  insertSystemAfterLastUser,
  parseGuidanceMessageRole,
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

describe('guidance-generate parseGuidanceMessageRole', () => {
  it('accepts system user assistant and falls back otherwise', () => {
    assert.equal(parseGuidanceMessageRole('user'), 'user')
    assert.equal(parseGuidanceMessageRole('assistant'), 'assistant')
    assert.equal(parseGuidanceMessageRole('system'), 'system')
    assert.equal(parseGuidanceMessageRole('nope'), 'system')
    assert.equal(parseGuidanceMessageRole(undefined, 'user'), 'user')
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

  it('returns depth 0 injectionOrder 0 system for send mode by default', async () => {
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
          injectionOrder: 0,
        },
      },
    ])
  })

  it('send mode respects guidanceRole setting', async () => {
    const injections = await resolveAfterAssemblePromptsAddition(
      {
        pluginId: 'guidance-generate',
        macroContext: {},
        plugins: {
          'guidance-generate': { mode: 'send', guidanceText: 'be kind' },
        },
      },
      {
        ...api,
        getUserPluginSettings: async () => ({
          systemPrefix: 'G: ',
          guidanceRole: 'user',
        }),
      },
    )
    assert.equal(injections?.[0]?.role, 'user')
    assert.equal(injections?.[0]?.content, 'G:be kind')
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

  it('revise returns assistant 0 + system 1 descriptors by default', async () => {
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
          injectionOrder: 0,
        },
      },
      {
        role: 'system',
        content: 'R:soften',
        position: {
          kind: 'chat',
          depth: 0,
          injectionOrder: 1,
        },
      },
    ])
  })

  it('revise respects reviseGuidanceRole setting', async () => {
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
      {
        ...api,
        getUserPluginSettings: async () => ({
          reviseSystemPrefix: 'R: ',
          reviseGuidanceRole: 'user',
        }),
      },
    )
    assert.equal(injections?.[0]?.role, 'assistant')
    assert.equal(injections?.[1]?.role, 'user')
    assert.equal(injections?.[1]?.content, 'R:soften')
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
