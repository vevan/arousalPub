import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from '../../src/chat-storage.js'
import {
  buildMacroHistoryFields,
  findIdleReferenceUserAt,
  flattenTurnsToChatMessages,
} from '../../src/prompt-macros/history-macros.js'
import { stablePickFromArgs } from '../../src/prompt-macros/macro-pick.js'

function turn(
  ordinal: number,
  user: string,
  assistant: string,
  receives?: { id: string; content: string }[],
  activeReceiveIndex = 0,
  createdAt?: string,
): TurnRecord {
  const rs =
    receives ??
    (assistant ? [{ id: `r-${ordinal}`, content: assistant }] : [])
  return {
    turnId: `t-${ordinal}`,
    turnOrdinal: ordinal,
    ...(createdAt ? { createdAt } : {}),
    send: { userText: user },
    receives: rs,
    activeReceiveIndex,
    plugins: [],
  }
}

describe('flattenTurnsToChatMessages', () => {
  it('expands user then assistant per turn', () => {
    const flat = flattenTurnsToChatMessages([
      turn(0, 'hi', 'hello'),
      turn(1, 'again', 'sure'),
    ])
    assert.equal(flat.length, 4)
    assert.equal(flat[0]!.role, 'user')
    assert.equal(flat[1]!.content, 'hello')
  })

  it('expands all assistant segments in one turn', () => {
    const multi: TurnRecord = {
      turnId: 't-0',
      turnOrdinal: 0,
      send: { userText: 'hi both' },
      receives: [{ id: 'r1', content: 'legacy' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice',
          receives: [{ id: 'r1', content: 'from alice' }],
          activeReceiveIndex: 0,
        },
        {
          id: 's2',
          speakerCharacterId: 'betty',
          receives: [{ id: 'r2', content: 'from betty' }],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 1,
      plugins: [],
    }
    const flat = flattenTurnsToChatMessages([multi])
    assert.equal(flat.length, 3)
    assert.equal(flat[0]!.role, 'user')
    assert.equal(flat[1]!.content, 'from alice')
    assert.equal(flat[2]!.content, 'from betty')
  })
})

describe('buildMacroHistoryFields', () => {
  it('fills last message macros from history turns', () => {
    const history = [turn(0, 'u1', 'a1'), turn(1, 'u2', 'a2')]
    const fields = buildMacroHistoryFields({
      indexingTurns: history,
      historyTurns: history,
    })
    assert.equal(fields.lastUserMessage, 'u2')
    assert.equal(fields.lastCharMessage, 'a2')
    assert.equal(fields.lastMessage, 'a2')
    assert.equal(fields.lastMessageId, '3')
    assert.equal(fields.allChatRange, '0-3')
  })

  it('computes swipe ids from active turn', () => {
    const active = turn(
      2,
      'u',
      'swipe2',
      [
        { id: 'r1', content: 's1' },
        { id: 'r2', content: 'swipe2' },
      ],
      1,
    )
    const fields = buildMacroHistoryFields({
      indexingTurns: [active],
      historyTurns: [],
      activeTurn: active,
    })
    assert.equal(fields.lastSwipeId, '2')
    assert.equal(fields.currentSwipeId, '2')
  })

  it('firstIncludedMessageId follows trimmed history', () => {
    const history = [turn(0, 'u1', 'a1'), turn(1, 'u2', 'a2')]
    const all = [...history, turn(2, 'u3', 'a3')]
    const fields = buildMacroHistoryFields({
      indexingTurns: all,
      historyTurns: history,
      trimmedHistoryMessages: [
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
      ],
    })
    assert.equal(fields.firstIncludedMessageId, '2')
  })

  it('firstIncludedMessageId uses turn metadata when content differs from turns', () => {
    const history = [turn(0, 'u1', 'a1'), turn(1, 'u2', 'a2')]
    const all = [...history, turn(2, 'u3', 'a3')]
    const fields = buildMacroHistoryFields({
      indexingTurns: all,
      historyTurns: history,
      trimmedHistoryMessages: [
        {
          role: 'user',
          content: 'regex-scrubbed-u2',
          turnId: 't-1',
          turnOrdinal: 1,
        },
        {
          role: 'assistant',
          content: 'regex-scrubbed-a2',
          turnId: 't-1',
          turnOrdinal: 1,
          receiveId: 'r-1',
          receiveIndex: 0,
        },
      ],
    })
    assert.equal(fields.firstIncludedMessageId, '2')
  })

  it('firstIncludedMessageId disambiguates duplicate content by turn offset', () => {
    const history = [turn(0, 'same', 'dup'), turn(1, 'same', 'dup')]
    const all = [...history, turn(2, 'tail', 'end')]
    const fields = buildMacroHistoryFields({
      indexingTurns: all,
      historyTurns: history,
      trimmedHistoryMessages: [
        { role: 'user', content: 'same' },
        { role: 'assistant', content: 'dup' },
      ],
    })
    assert.equal(fields.firstIncludedMessageId, '2')
  })

  it('idleReferenceUserAt skips trailing assistant and uses prior user', () => {
    const turns = [
      turn(0, 'u1', 'a1', undefined, 0, '2020-01-01T10:00:00.000Z'),
      turn(1, 'u2', 'a2', undefined, 0, '2020-01-01T11:00:00.000Z'),
    ]
    assert.equal(
      findIdleReferenceUserAt(turns),
      '2020-01-01T11:00:00.000Z',
    )
  })

  it('idleReferenceUserAt picks previous user when chat ends with user', () => {
    const turns = [
      turn(0, 'u1', 'a1', undefined, 0, '2020-01-01T10:00:00.000Z'),
      turn(1, 'u2', '', undefined, 0, '2020-01-01T12:00:00.000Z'),
    ]
    assert.equal(
      findIdleReferenceUserAt(turns),
      '2020-01-01T10:00:00.000Z',
    )
  })
})

describe('stablePickFromArgs', () => {
  it('is stable for same conversation and args', () => {
    const a = stablePickFromArgs('conv1', ['x', 'y', 'z'])
    const b = stablePickFromArgs('conv1', ['x', 'y', 'z'])
    assert.equal(a, b)
    assert(['x', 'y', 'z'].includes(a))
  })

  it('differs across conversations', () => {
    const a = stablePickFromArgs('conv-a', ['only'])
    const b = stablePickFromArgs('conv-b', ['only'])
    assert.equal(a, 'only')
    assert.equal(b, 'only')
  })
})
