import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from '../src/assemble-prompts.js'
import { buildPromptMacroContext } from '../src/prompt-macros/context.js'
import {
  applyOutgoingRegexToMemoryItems,
  applyRegexOutgoingToMessages,
  buildPerMessageTurnOrdinals,
  findHistorySpanInMessages,
  resolveOutgoingSkipTailOrdinal,
  resolveOutgoingTailOrdinal,
} from '../src/regex-outgoing.js'
import type { TurnRecord } from '../src/chat-storage.js'
import { testTurn } from './fixtures/turn-record.js'
import { assistantTextFromTurn, formatMemoryXml } from '../src/turn-memory-xml.js'
import type { RegexRule } from '../src/regex-rules-types.js'

function turn(
  ordinal: number,
  user: string,
  assistant: string,
  id = `${ordinal}`.padStart(8, '0'),
): TurnRecord {
  return testTurn({
    turnId: id,
    turnOrdinal: ordinal,
    userText: user,
    receives: [{ id: 'r1', content: assistant }],
  })
}

function rule(partial: Partial<RegexRule> & Pick<RegexRule, 'id'>): RegexRule {
  const skipLastNTurns = partial.skipLastNTurns ?? 0
  return {
    label: partial.label ?? partial.id,
    order: partial.order ?? 10,
    enabled: partial.enabled ?? true,
    phases: partial.phases ?? ['outgoing'],
    fields: partial.fields ?? ['assistant'],
    skipLastNTurns,
    skipLastNTurnsDisplay: partial.skipLastNTurnsDisplay ?? skipLastNTurns,
    skipLastNTurnsOutgoing: partial.skipLastNTurnsOutgoing ?? skipLastNTurns,
    skipLastNTurnsPersist: partial.skipLastNTurnsPersist ?? skipLastNTurns,
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

  it('strips tracker inside memory block for turns before skip window', () => {
    const memoryTurns = [
      { turn: turn(0, 'u0', 'mem0 <<track>>'), score: 0.9 },
      { turn: turn(3, 'u3', 'mem3 <<track>>'), score: 0.8 },
    ]
    const memoryXml = formatMemoryXml(memoryTurns)
    const messages: ChatMessage[] = [
      { role: 'system', content: 'world' },
      { role: 'system', content: memoryXml },
      { role: 'user', content: 'u4' },
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
      tailOrdinal: 4,
      sourceHistoryMessages: [],
      sourceHistoryTurnOrdinals: [],
      trimmedHistoryMessages: [],
      memoryItems: memoryTurns,
      userInput: 'u4',
    })
    const mem = out[1]?.content ?? ''
    assert.match(mem, /<assistant charName="\{\{char\}\}">mem0<\/assistant>/)
    assert.match(mem, /mem3 &lt;&lt;track&gt;&gt;/)
  })

  it('re-expands memory role macros after rebuild when macroContext given', () => {
    const memoryTurns = [{ turn: turn(0, 'u0', 'mem0'), score: 0.9 }]
    const memoryXml = formatMemoryXml(memoryTurns)
    const messages: ChatMessage[] = [{ role: 'system', content: memoryXml }]
    const macroContext = buildPromptMacroContext({
      conversationUserName: '小明',
      characters: [{ name: '艾拉' }],
    })
    const rules = [
      rule({
        id: '11111111',
        fields: ['assistant'],
        pattern: 'never-match-x',
        replacement: '',
      }),
    ]
    const out = applyRegexOutgoingToMessages(messages, rules, {
      tailOrdinal: 1,
      sourceHistoryMessages: [],
      sourceHistoryTurnOrdinals: [],
      trimmedHistoryMessages: [],
      memoryItems: memoryTurns,
      macroContext,
    })
    assert.match(out[0]!.content, /userName="小明"/)
    assert.match(out[0]!.content, /charName="艾拉"/)
  })

  it('applyOutgoingRegexToMemoryItems strips all segments in multi-segment turn', () => {
    const track = '<<track>>'
    const turn: TurnRecord = testTurn({
      turnOrdinal: 0,
      userText: 'u',
      activeSegmentIndex: 1,
      segments: [
        {
          id: 's0',
          speakerCharacterId: 'alice',
          receives: [{ id: 'r0', content: `a0 ${track}` }],
          activeReceiveIndex: 0,
        },
        {
          id: 's1',
          speakerCharacterId: 'betty',
          receives: [{ id: 'r1', content: `b0 ${track}` }],
          activeReceiveIndex: 0,
        },
      ],
    })
    const items = [{ turn, score: 1 }]
    const rules = [
      rule({
        id: '11111111',
        fields: ['assistant'],
        pattern: track,
        replacement: '',
      }),
    ]
    const out = applyOutgoingRegexToMemoryItems(items, rules, 5)
    const xml = formatMemoryXml(out)
    assert.match(xml, /a0<\/assistant>/)
    assert.match(xml, /b0<\/assistant>/)
    assert.doesNotMatch(xml, /track/)
  })

  it('strips tracker when turn text stores XML entities on disk', () => {
    const items = [
      {
        turn: turn(0, 'u', '&lt;ex-tracker&gt;hello'),
        score: 1,
      },
    ]
    const rules = [
      rule({
        id: '11111111',
        fields: ['assistant'],
        pattern: '<ex-tracker>',
        replacement: '',
      }),
    ]
    const out = applyOutgoingRegexToMemoryItems(items, rules, 5)
    assert.equal(assistantTextFromTurn(out[0]!.turn), 'hello')
    const xml = formatMemoryXml(out)
    assert.match(xml, /<assistant charName="\{\{char\}\}">hello<\/assistant>/)
    assert.doesNotMatch(xml, /ex-tracker/)
  })

  it('applyOutgoingRegexToMemoryItems respects skipLastNTurns per ordinal', () => {
    const items = [
      { turn: turn(0, 'u', 'a0 <<track>>'), score: 1 },
      { turn: turn(3, 'u', 'a3 <<track>>'), score: 0.5 },
    ]
    const rules = [
      rule({
        id: '11111111',
        fields: ['assistant'],
        skipLastNTurns: 2,
        pattern: '<<track>>',
        replacement: '',
      }),
    ]
    const out = applyOutgoingRegexToMemoryItems(items, rules, 5)
    assert.equal(assistantTextFromTurn(out[0]!.turn), 'a0 ')
    assert.equal(assistantTextFromTurn(out[1]!.turn), 'a3 <<track>>')
  })

  it('respects skipLastNTurns when history user text was macro-expanded', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'u0', turnOrdinal: 0 },
      { role: 'assistant', content: 'a0 <<track>>', turnOrdinal: 0 },
      { role: 'user', content: 'hello {{char}}', turnOrdinal: 1 },
      { role: 'assistant', content: 'a1 <<track>>', turnOrdinal: 1 },
    ]
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u0', turnOrdinal: 0 },
      { role: 'assistant', content: 'a0 ', turnOrdinal: 0 },
      { role: 'user', content: 'hello 艾拉', turnOrdinal: 1 },
      { role: 'assistant', content: 'a1 <<track>>', turnOrdinal: 1 },
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
