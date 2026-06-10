import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from './assemble-prompts.js'
import {
  applyRegexOutgoingToMessages,
  buildPerMessageTurnOrdinals,
  findHistorySpanInMessages,
  resolveOutgoingTailOrdinal,
} from './regex-outgoing.js'
import type { RegexRule } from './regex-rules-types.js'

function rule(partial: Partial<RegexRule> & Pick<RegexRule, 'id'>): RegexRule {
  return {
    label: partial.label ?? partial.id,
    order: partial.order ?? 10,
    enabled: partial.enabled ?? true,
    phases: partial.phases ?? ['outgoing'],
    fields: partial.fields ?? ['assistant'],
    skipLastNTurns: partial.skipLastNTurns ?? 0,
    pattern: partial.pattern ?? '',
    flags: partial.flags ?? 'g',
    replacement: partial.replacement ?? '',
    ...partial,
  }
}

describe('resolveOutgoingTailOrdinal', () => {
  it('uses regenerate ordinal when beforeExclusive set', () => {
    assert.equal(
      resolveOutgoingTailOrdinal({
        sourceHistoryTurnOrdinals: [0, 1, 2],
        historyBeforeTurnOrdinalExclusive: 2,
      }),
      2,
    )
  })

  it('returns next ordinal for normal send', () => {
    assert.equal(
      resolveOutgoingTailOrdinal({ sourceHistoryTurnOrdinals: [0, 1] }),
      2,
    )
    assert.equal(resolveOutgoingTailOrdinal({ sourceHistoryTurnOrdinals: [] }), 0)
  })
})

describe('buildPerMessageTurnOrdinals', () => {
  it('maps user and assistant to turn ordinal', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'u0' },
      { role: 'assistant', content: 'a0' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
    ]
    assert.deepEqual(buildPerMessageTurnOrdinals(history, [0, 1]), [0, 0, 1, 1])
  })
})

describe('findHistorySpanInMessages', () => {
  it('finds contiguous history block', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
    ]
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      ...history,
      { role: 'user', content: 'new' },
    ]
    assert.deepEqual(findHistorySpanInMessages(messages, history), {
      start: 1,
      length: 2,
    })
  })
})

describe('applyRegexOutgoingToMessages', () => {
  it('strips tracker from older assistant via skipLastNTurns', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'u0' },
      { role: 'assistant', content: 'old <<track>>' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'new <<track>>' },
    ]
    const messages: ChatMessage[] = [
      { role: 'system', content: 'world' },
      ...history,
    ]
    const rules = [
      rule({
        id: '11111111',
        fields: ['assistant'],
        skipLastNTurns: 1,
        pattern: '<<track>>',
        replacement: '',
      }),
    ]
    const out = applyRegexOutgoingToMessages(messages, rules, {
      tailOrdinal: 1,
      sourceHistoryMessages: history,
      sourceHistoryTurnOrdinals: [0, 1],
      trimmedHistoryMessages: history,
    })
    assert.equal(out[2]?.content, 'old ')
    assert.equal(out[4]?.content, 'new <<track>>')
  })

  it('applies system rules without turnOrdinal', () => {
    const messages: ChatMessage[] = [{ role: 'system', content: '<<x>>' }]
    const rules = [
      rule({
        id: '11111111',
        fields: ['system'],
        pattern: '<<x>>',
        replacement: '',
      }),
    ]
    const out = applyRegexOutgoingToMessages(messages, rules, {
      tailOrdinal: 0,
      sourceHistoryMessages: [],
      sourceHistoryTurnOrdinals: [],
      trimmedHistoryMessages: [],
    })
    assert.equal(out[0]?.content, '')
  })
})
