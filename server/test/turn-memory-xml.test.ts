import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from '../src/chat-storage.js'
import {
  formatHistoryXml,
  formatMemoryXml,
  turnsToHistoryMessages,
} from '../src/turn-memory-xml.js'

function turn(
  ordinal: number,
  user: string,
  assistant: string,
  id = `${ordinal}`.padStart(8, '0'),
): TurnRecord {
  return {
    turnId: id,
    turnOrdinal: ordinal,
    send: { userText: user },
    receives: [{ id: 'r1', content: assistant }],
    activeReceiveIndex: 0,
    plugins: [],
  }
}

describe('formatMemoryXml', () => {
  it('omits turn id and uses correlation attribute', () => {
    const xml = formatMemoryXml([
      { turn: turn(3, 'u', 'a'), score: 0.8234 },
    ])
    assert.match(xml, /<turn ordinal="3" correlation="0\.8234">/)
    assert.doesNotMatch(xml, /\bid=/)
  })
})

describe('formatHistoryXml', () => {
  it('keeps turn id and omits correlation', () => {
    const xml = formatHistoryXml([turn(1, 'u', 'a', 'abcd1234')])
    assert.match(xml, /<turn id="abcd1234" ordinal="1">/)
    assert.doesNotMatch(xml, /correlation=/)
  })
})

describe('turnsToHistoryMessages partial turn', () => {
  it('includes user once with partial assistant segments only', () => {
    const t: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 5,
      send: { userText: 'hello' },
      receives: [{ id: 'r1', content: 'a1' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice',
          receives: [{ id: 'r1', content: 'a1' }],
          activeReceiveIndex: 0,
        },
        {
          id: 's2',
          speakerCharacterId: 'betty',
          receives: [{ id: 'r2', content: 'a2' }],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 1,
      plugins: [],
    }
    const msgs = turnsToHistoryMessages([t], {
      defaultSpeakerCharacterId: 'alice',
      partialTurn: { turnOrdinal: 5, segmentIndexExclusive: 1 },
    })
    assert.deepEqual(
      msgs.map((m) => ({ role: m.role, content: m.content })),
      [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'a1' },
      ],
    )
  })
})
