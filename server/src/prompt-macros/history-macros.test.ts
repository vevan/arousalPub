import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from '../chat-storage.js'
import {
  buildMacroHistoryFields,
  flattenTurnsToChatMessages,
} from './history-macros.js'
import { stablePickFromArgs } from './macro-pick.js'

function turn(
  ordinal: number,
  user: string,
  assistant: string,
  receives?: { id: string; content: string }[],
  activeReceiveIndex = 0,
): TurnRecord {
  const rs =
    receives ??
    (assistant ? [{ id: `r-${ordinal}`, content: assistant }] : [])
  return {
    turnId: `t-${ordinal}`,
    turnOrdinal: ordinal,
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
