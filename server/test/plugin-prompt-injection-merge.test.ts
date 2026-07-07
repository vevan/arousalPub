import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AFTER_USER_INPUT_IMPLICIT_INJECTION_ORDER,
  buildPluginAfterUserInputHintFromMessages,
  mergePluginPromptInjectionsIntoMessages,
} from '../src/plugin-prompt-injection-merge.js'
import {
  isPluginPromptInjection,
  parsePluginPromptInjections,
} from '../src/shared/plugin-prompt-injection.js'

describe('parsePluginPromptInjections', () => {
  it('parses valid chat injections', () => {
    const parsed = parsePluginPromptInjections([
      {
        role: 'system',
        content: 'guidance',
        position: { kind: 'chat', depth: 0, injectionOrder: 10 },
      },
    ])
    assert.ok(parsed)
    assert.equal(parsed!.length, 1)
    assert.equal(parsed![0]!.content, 'guidance')
  })

  it('accepts legacy position.order alias', () => {
    const parsed = parsePluginPromptInjections([
      {
        role: 'system',
        content: 'guidance',
        position: { kind: 'chat', depth: 0, order: 10 },
      },
    ])
    assert.ok(parsed)
    assert.equal(parsed![0]!.position.injectionOrder, 10)
  })

  it('rejects empty content', () => {
    assert.equal(
      parsePluginPromptInjections([
        { role: 'system', content: '  ', position: { kind: 'chat', depth: 0 } },
      ]),
      null,
    )
  })

  it('rejects non-chat position', () => {
    assert.equal(isPluginPromptInjection({ role: 'system', content: 'x', position: { kind: 'relative' } }), false)
  })
})

describe('mergePluginPromptInjectionsIntoMessages', () => {
  it('places injectionOrder 10 before 500 at depth 0 after last user', () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { messages } = mergePluginPromptInjectionsIntoMessages(base, [
      {
        role: 'system',
        content: 'tracker',
        position: { kind: 'chat', depth: 0, injectionOrder: 500 },
      },
      {
        role: 'system',
        content: 'guide',
        position: { kind: 'chat', depth: 0, injectionOrder: 10 },
      },
    ])
    assert.deepEqual(
      messages.map((m) => m.content),
      ['main', 'hello', 'guide', 'tracker'],
    )
  })

  it('shifts history span when inserting before history block', () => {
    const base = [
      { role: 'system' as const, content: 'hist' },
      { role: 'user' as const, content: 'u1' },
      { role: 'user' as const, content: 'u2' },
    ]
    const { span } = mergePluginPromptInjectionsIntoMessages(
      base,
      [
        {
          role: 'system',
          content: 'inj',
          position: { kind: 'chat', depth: 3, injectionOrder: 1 },
        },
      ],
      { historyStart: 0, historyEnd: 1 },
    )
    assert.equal(span.historyStart, 1)
    assert.equal(span.historyEnd, 2)
  })

  it('places revise assistant 11 before guidance system 12', () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { messages } = mergePluginPromptInjectionsIntoMessages(base, [
      {
        role: 'system',
        content: 'revise guide',
        position: { kind: 'chat', depth: 0, injectionOrder: 12 },
      },
      {
        role: 'assistant',
        content: 'draft',
        position: { kind: 'chat', depth: 0, injectionOrder: 11 },
      },
    ])
    assert.deepEqual(
      messages.map((m) => `${m.role}:${m.content}`),
      ['system:main', 'user:hello', 'assistant:draft', 'system:revise guide'],
    )
  })

  it('interleaves afterUserInput injectionOrder 20 between guidance 10 and tracker 500', () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
      { role: 'system' as const, content: 'GROUP-CHAT-RULE' },
    ]
    const { messages } = mergePluginPromptInjectionsIntoMessages(
      base,
      [
        {
          role: 'system',
          content: 'tracker',
          position: { kind: 'chat', depth: 0, injectionOrder: 500 },
        },
        {
          role: 'system',
          content: 'guide',
          position: { kind: 'chat', depth: 0, injectionOrder: 10 },
        },
      ],
      { historyStart: -1, historyEnd: -1 },
      {
        afterUserInput: {
          content: 'GROUP-CHAT-RULE',
          role: 'system',
          implicitInjectionOrder: AFTER_USER_INPUT_IMPLICIT_INJECTION_ORDER,
        },
      },
    )
    assert.deepEqual(
      messages.map((m) => m.content),
      ['main', 'hello', 'guide', 'GROUP-CHAT-RULE', 'tracker'],
    )
  })

  it('hoists preset chat depth 0 after guidance when both sit in post-user tail', () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
      { role: 'system' as const, content: 'GROUP-CHAT-RULE' },
      { role: 'system' as const, content: 'PRESET-CHAT-0' },
    ]
    const { messages } = mergePluginPromptInjectionsIntoMessages(
      base,
      [
        {
          role: 'system',
          content: 'tracker',
          position: { kind: 'chat', depth: 0, injectionOrder: 500 },
        },
        {
          role: 'system',
          content: 'guide',
          position: { kind: 'chat', depth: 0, injectionOrder: 10 },
        },
      ],
      { historyStart: -1, historyEnd: -1 },
      {
        afterUserInput: {
          content: 'GROUP-CHAT-RULE',
          role: 'system',
        },
      },
    )
    assert.deepEqual(
      messages.map((m) => m.content),
      [
        'main',
        'hello',
        'guide',
        'GROUP-CHAT-RULE',
        'PRESET-CHAT-0',
        'tracker',
      ],
    )
  })

  it('matches afterUserInput by expanded content when macro changed the body', () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
      { role: 'system' as const, content: 'EXPANDED-GROUP-RULE' },
    ]
    const { messages } = mergePluginPromptInjectionsIntoMessages(
      base,
      [
        {
          role: 'system',
          content: 'guide',
          position: { kind: 'chat', depth: 0, injectionOrder: 10 },
        },
      ],
      { historyStart: -1, historyEnd: -1 },
      {
        afterUserInput: {
          content: 'EXPANDED-GROUP-RULE',
          role: 'system',
        },
      },
    )
    assert.deepEqual(
      messages.map((m) => m.content),
      ['main', 'hello', 'guide', 'EXPANDED-GROUP-RULE'],
    )
  })

  it('does not label authorsNote depth 0 as afterUserInput when using excludeContents', () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
      { role: 'system' as const, content: 'EXPANDED-AUTHORS' },
      { role: 'system' as const, content: 'EXPANDED-GROUP-RULE' },
      { role: 'system' as const, content: 'PRESET-CHAT-0' },
    ]
    const { messages } = mergePluginPromptInjectionsIntoMessages(
      base,
      [
        {
          role: 'system',
          content: 'tracker',
          position: { kind: 'chat', depth: 0, injectionOrder: 500 },
        },
        {
          role: 'system',
          content: 'guide',
          position: { kind: 'chat', depth: 0, injectionOrder: 10 },
        },
      ],
      { historyStart: -1, historyEnd: -1 },
      {
        afterUserInput: {
          content: 'EXPANDED-GROUP-RULE',
          role: 'system',
          excludeContents: ['EXPANDED-AUTHORS'],
        },
      },
    )
    assert.deepEqual(
      messages.map((m) => m.content),
      [
        'main',
        'hello',
        'guide',
        'EXPANDED-GROUP-RULE',
        'EXPANDED-AUTHORS',
        'PRESET-CHAT-0',
        'tracker',
      ],
    )
  })
})

describe('buildPluginAfterUserInputHintFromMessages', () => {
  it('matches group content when authorsNote exclude is provided', () => {
    const messages = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
      { role: 'system' as const, content: 'REGEX-AUTHORS' },
      { role: 'system' as const, content: 'REGEX-GROUP-RULE' },
    ]
    const hint = buildPluginAfterUserInputHintFromMessages(messages, {
      groupChatContent: 'REGEX-GROUP-RULE',
      authorsNoteExcludeContent: 'REGEX-AUTHORS',
    })
    assert.deepEqual(hint, {
      content: 'REGEX-GROUP-RULE',
      role: 'system',
      excludeContents: ['REGEX-AUTHORS'],
    })
  })

  it('matches group content without authorsNote exclude', () => {
    const messages = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
      { role: 'system' as const, content: 'REGEX-GROUP-RULE' },
      { role: 'system' as const, content: 'PRESET-CHAT-0' },
    ]
    const hint = buildPluginAfterUserInputHintFromMessages(messages, {
      groupChatContent: 'REGEX-GROUP-RULE',
    })
    assert.deepEqual(hint, {
      content: 'REGEX-GROUP-RULE',
      role: 'system',
    })
  })

  it('returns undefined when group content is absent from tail', () => {
    const messages = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
      { role: 'system' as const, content: 'PRESET-CHAT-0' },
    ]
    const hint = buildPluginAfterUserInputHintFromMessages(messages, {
      groupChatContent: 'REGEX-GROUP-RULE',
    })
    assert.equal(hint, undefined)
  })
})
