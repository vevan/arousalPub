import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnReceive } from '../src/chat-storage.js'
import { applyRegexPersistToTurnPatch } from '../src/regex-persist-patch.js'
import type { RegexRule } from '../src/regex-rules-types.js'

function rule(partial: Partial<RegexRule> & Pick<RegexRule, 'id'>): RegexRule {
  const skipLastNTurns = partial.skipLastNTurns ?? 0
  return {
    label: partial.label ?? partial.id,
    order: partial.order ?? 10,
    enabled: partial.enabled ?? true,
    phases: partial.phases ?? ['persist'],
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

function makePatch(
  turnOrdinal: number,
  userText: string,
  receives: TurnReceive[],
) {
  return {
    turnOrdinal,
    userText,
    receives,
    activeReceiveIndex: 0,
  }
}

describe('applyRegexPersistToTurnPatch', () => {
  it('normalizes user and all receives before write', () => {
    const rules = [
      rule({
        id: '11111111',
        fields: ['user', 'assistant'],
        pattern: '\\.{3,}',
        replacement: '…',
      }),
    ]
    const out = applyRegexPersistToTurnPatch(
      rules,
      makePatch(2, 'wait...', [
        { id: 'aaaaaaaa', content: 'ok...' },
        { id: 'bbbbbbbb', content: 'no change' },
      ]),
      5,
    )
    assert.equal(out.userText, 'wait…')
    assert.equal(out.receives[0]?.content, 'ok…')
    assert.equal(out.receives[1]?.content, 'no change')
  })

  it('respects skipLastNTurns against conversation tail', () => {
    const rules = [
      rule({
        id: '11111111',
        fields: ['user'],
        skipLastNTurns: 1,
        pattern: 'x',
        replacement: '',
      }),
    ]
    const oldTurn = applyRegexPersistToTurnPatch(
      rules,
      makePatch(2, 'x', [{ id: 'aaaaaaaa', content: '' }]),
      3,
    )
    const recentTurn = applyRegexPersistToTurnPatch(
      rules,
      makePatch(3, 'x', [{ id: 'aaaaaaaa', content: '' }]),
      3,
    )
    assert.equal(oldTurn.userText, '')
    assert.equal(recentTurn.userText, 'x')
  })
})
