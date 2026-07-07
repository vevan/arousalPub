import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergePluginPromptInjectionsIntoMessages } from '../src/plugin-prompt-injection-merge.js'
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
        position: { kind: 'chat', depth: 0, order: 1 },
      },
    ])
    assert.ok(parsed)
    assert.equal(parsed!.length, 1)
    assert.equal(parsed![0]!.content, 'guidance')
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
  it('places order 1 before order 999 at depth 0 after last user', () => {
    const base = [
      { role: 'system' as const, content: 'main' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { messages } = mergePluginPromptInjectionsIntoMessages(base, [
      {
        role: 'system',
        content: 'tracker',
        position: { kind: 'chat', depth: 0, order: 999 },
      },
      {
        role: 'system',
        content: 'guide',
        position: { kind: 'chat', depth: 0, order: 1 },
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
          position: { kind: 'chat', depth: 3, order: 1 },
        },
      ],
      { historyStart: 0, historyEnd: 1 },
    )
    assert.equal(span.historyStart, 1)
    assert.equal(span.historyEnd, 2)
  })
})
