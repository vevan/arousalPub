import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from '../src/assemble-prompts.js'
import type { TurnRecord } from '../src/chat-storage.js'
import {
  applyRegexOutgoingToMessages,
  buildPerMessageTurnOrdinals,
} from '../src/regex-outgoing.js'
import type { RegexRule } from '../src/regex-rules-types.js'
import { turnsToHistoryMessages } from '../src/turn-memory-xml.js'
import { testTurn } from './fixtures/turn-record.js'

const TRACK = '<<track>>'

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

function multiSegTurn(
  ordinal: number,
  user: string,
  alice: string,
  betty: string,
): TurnRecord {
  return testTurn({
    turnId: `t-${ordinal}`,
    turnOrdinal: ordinal,
    userText: user,
    activeSegmentIndex: 1,
    segments: [
      {
        id: `s-${ordinal}-0`,
        speakerCharacterId: 'alice',
        receives: [{ id: `r-${ordinal}-0`, content: alice }],
        activeReceiveIndex: 0,
      },
      {
        id: `s-${ordinal}-1`,
        speakerCharacterId: 'betty',
        receives: [{ id: `r-${ordinal}-1`, content: betty }],
        activeReceiveIndex: 0,
      },
    ],
  })
}

describe('group chat outgoing assemble integration', () => {
  it('turnsToHistoryMessages emits one assistant message per segment', () => {
    const turns = [multiSegTurn(0, 'u0', `alice ${TRACK}`, `betty ${TRACK}`)]
    const msgs = turnsToHistoryMessages(turns, { defaultSpeakerCharacterId: 'alice' })
    assert.equal(msgs.filter((m) => m.role === 'assistant').length, 2)
    assert.equal(msgs[1]?.content, `alice ${TRACK}`)
    assert.equal(msgs[2]?.content, `betty ${TRACK}`)
    assert.equal(msgs[1]?.turnOrdinal, 0)
    assert.equal(msgs[2]?.turnOrdinal, 0)
    assert.equal(msgs[1]?.segmentIndex, 0)
    assert.equal(msgs[2]?.segmentIndex, 1)
  })

  it('buildPerMessageTurnOrdinals maps both assistants in same turn', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'u0', turnOrdinal: 0 },
      { role: 'assistant', content: 'a0', turnOrdinal: 0, segmentIndex: 0 },
      { role: 'assistant', content: 'b0', turnOrdinal: 0, segmentIndex: 1 },
      { role: 'user', content: 'u1', turnOrdinal: 1 },
      { role: 'assistant', content: 'a1', turnOrdinal: 1, segmentIndex: 0 },
    ]
    assert.deepEqual(buildPerMessageTurnOrdinals(history, [0, 1]), [0, 0, 0, 1, 1])
  })

  it('strips tracker from all segments on older turns, keeps on recent skip window', () => {
    const turns = [
      multiSegTurn(0, 'u0', `old-a ${TRACK}`, `old-b ${TRACK}`),
      multiSegTurn(1, 'u1', `mid-a ${TRACK}`, `mid-b ${TRACK}`),
      multiSegTurn(2, 'u2', `new-a ${TRACK}`, `new-b ${TRACK}`),
    ]
    const history = turnsToHistoryMessages(turns, { defaultSpeakerCharacterId: 'alice' })
    const historyMessages: ChatMessage[] = history.map((m) => ({
      role: m.role,
      content: m.content,
      turnOrdinal: m.turnOrdinal,
      segmentIndex: m.segmentIndex,
    }))
    const messages: ChatMessage[] = [
      { role: 'system', content: 'world' },
      ...historyMessages,
      { role: 'user', content: 'u3' },
    ]
    const rules = [
      rule({
        id: '11111111',
        fields: ['assistant'],
        skipLastNTurns: 1,
        pattern: TRACK,
        replacement: '',
      }),
    ]
    const out = applyRegexOutgoingToMessages(messages, rules, {
      tailOrdinal: 3,
      sourceHistoryMessages: historyMessages,
      sourceHistoryTurnOrdinals: turns.map((t) => t.turnOrdinal),
      trimmedHistoryMessages: historyMessages,
      userInput: 'u3',
    })

    const assistantContents = out
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
    assert.deepEqual(assistantContents, [
      'old-a ',
      'old-b ',
      'mid-a ',
      'mid-b ',
      'new-a <<track>>',
      'new-b <<track>>',
    ])
  })
})
