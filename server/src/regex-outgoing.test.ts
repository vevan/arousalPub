import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from './assemble-prompts.js'
import {
  applyRegexOutgoingToMessages,
  buildPerMessageTurnOrdinals,
  findHistorySpanInMessages,
  resolveOutgoingSkipTailOrdinal,
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

describe('resolveOutgoingSkipTailOrdinal', () => {
  it('uses last assistant ordinal (tail minus in-flight turn)', () => {
    assert.equal(resolveOutgoingSkipTailOrdinal(4), 3)
    assert.equal(resolveOutgoingSkipTailOrdinal(2), 1)
    assert.equal(resolveOutgoingSkipTailOrdinal(0), 0)
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
  it('strips tracker from older assistant via skipLastNTurns on append send', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'u0' },
      { role: 'assistant', content: 'old <<track>>' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'new <<track>>' },
    ]
    const messages: ChatMessage[] = [
      { role: 'system', content: 'world' },
      ...history,
      { role: 'user', content: 'u2' },
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
      tailOrdinal: 2,
      sourceHistoryMessages: history,
      sourceHistoryTurnOrdinals: [0, 1],
      trimmedHistoryMessages: history,
      userInput: 'u2',
    })
    assert.equal(out[2]?.content, 'old ')
    assert.equal(out[4]?.content, 'new <<track>>')
  })

  it('keeps last N assistant rounds without counting in-flight user on append', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'u0' },
      { role: 'assistant', content: 'a0 <<track>>' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1 <<track>>' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2 <<track>>' },
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: 'a3 <<track>>' },
    ]
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      ...history,
      { role: 'user', content: 'u4' },
    ]
    const rules = [
      rule({
        id: '11111111',
        fields: ['assistant'],
        skipLastNTurns: 3,
        pattern: '<<track>>',
        replacement: '',
      }),
    ]
    const out = applyRegexOutgoingToMessages(messages, rules, {
      tailOrdinal: 4,
      sourceHistoryMessages: history,
      sourceHistoryTurnOrdinals: [0, 1, 2, 3],
      trimmedHistoryMessages: history,
      userInput: 'u4',
    })
    assert.equal(out[2]?.content, 'a0 ')
    assert.equal(out[4]?.content, 'a1 <<track>>')
    assert.equal(out[6]?.content, 'a2 <<track>>')
    assert.equal(out[8]?.content, 'a3 <<track>>')
  })

  it('keeps last N assistant rounds on regenerate (no in-flight assistant)', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'u0' },
      { role: 'assistant', content: 'a0 <<track>>' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1 <<track>>' },
    ]
    const messages: ChatMessage[] = [
      { role: 'system', content: 'world' },
      ...history,
      { role: 'user', content: 'u2' },
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
      tailOrdinal: 2,
      sourceHistoryMessages: history,
      sourceHistoryTurnOrdinals: [0, 1],
      trimmedHistoryMessages: history,
      userInput: 'u2',
    })
    assert.equal(out[2]?.content, 'a0 ')
    assert.equal(out[4]?.content, 'a1 <<track>>')
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
