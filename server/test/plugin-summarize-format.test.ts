import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getTurnUserText, type TurnRecord } from '../src/chat-storage.js'
import {
  applyOutgoingRegexToSummaryTurn,
  formatSummarizeTranscript,
  wrapSummarizeTurnLine,
} from '../src/plugin-summarize-format.js'
import type { RegexRule } from '../src/regex-rules-types.js'

describe('wrapSummarizeTurnLine', () => {
  it('wraps user line with userName macro', () => {
    const line = wrapSummarizeTurnLine('user', 'hello')
    assert.equal(
      line,
      '<user userName="{{user}}">hello</user>',
    )
  })

  it('wraps assistant line with charName macro', () => {
    const line = wrapSummarizeTurnLine('assistant', 'reply')
    assert.equal(
      line,
      '<assistant charName="{{char}}">reply</assistant>',
    )
  })

  it('returns empty for blank text', () => {
    assert.equal(wrapSummarizeTurnLine('user', '   '), '')
  })
})

describe('formatSummarizeTranscript', () => {
  it('emits xml user/assistant per turn separated by newlines', () => {
    const turns: TurnRecord[] = [
      {
        turnId: 't0',
        turnOrdinal: 0,
        send: { userText: 'hi' },
        receives: [{ id: 'r0', content: 'hello back' }],
        activeReceiveIndex: 0,
        plugins: [],
      },
    ]
    const out = formatSummarizeTranscript(turns, 'Alice', 'Bob')
    assert.equal(
      out,
      '<user userName="{{user}}">hi</user>\n<assistant charName="{{char}}">hello back</assistant>',
    )
  })
})

describe('applyOutgoingRegexToSummaryTurn', () => {
  const rule: RegexRule = {
    id: 'r1',
    label: 'strip',
    order: 10,
    enabled: true,
    phases: ['outgoing'],
    fields: ['assistant'],
    skipLastNTurns: 0,
    skipLastNTurnsDisplay: 0,
    skipLastNTurnsOutgoing: 0,
    skipLastNTurnsPersist: 0,
    pattern: 'TRACK',
    flags: 'g',
    replacement: '',
  }

  it('applies outgoing rules to assistant only', () => {
    const turn: TurnRecord = {
      turnId: 't0',
      turnOrdinal: 0,
      send: { userText: 'TRACK hi' },
      receives: [{ id: 'r0', content: 'TRACK ok' }],
      activeReceiveIndex: 0,
      plugins: [],
    }
    const out = applyOutgoingRegexToSummaryTurn(turn, [rule], 0)
    assert.equal(getTurnUserText(out), 'TRACK hi')
    assert.equal(out.receives[0]?.content, ' ok')
  })

  it('regexApplyAllTurns ignores skipLastNTurns on recent turns', () => {
    const skipRule: RegexRule = {
      ...rule,
      skipLastNTurns: 3,
      skipLastNTurnsOutgoing: 3,
    }
    const turn: TurnRecord = {
      turnId: 't9',
      turnOrdinal: 9,
      send: { userText: 'u' },
      receives: [{ id: 'r0', content: 'TRACK ok' }],
      activeReceiveIndex: 0,
      plugins: [],
    }
    const skipped = applyOutgoingRegexToSummaryTurn(turn, [skipRule], 10, false)
    assert.equal(skipped.receives[0]?.content, 'TRACK ok')
    const applied = applyOutgoingRegexToSummaryTurn(turn, [skipRule], 10, true)
    assert.equal(applied.receives[0]?.content, ' ok')
  })
})
