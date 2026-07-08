import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getTurnUserText, type TurnRecord } from '../src/chat-storage.js'
import { testTurn } from './fixtures/turn-record.js'
import {
  applyOutgoingRegexToSummaryTurn,
  formatSummarizeTranscript,
  stripBlockTagsOnTurnSegment,
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
      testTurn({
        turnId: 't0',
        turnOrdinal: 0,
        userText: 'hi',
        receives: [{ id: 'r0', content: 'hello back' }],
      }),
    ]
    const out = formatSummarizeTranscript(turns, 'Alice', 'Bob')
    assert.equal(
      out,
      '<user userName="{{user}}">hi</user>\n<assistant charName="{{char}}">hello back</assistant>',
    )
  })

  it('emits one assistant line per segment in group chat turn', () => {
    const turns: TurnRecord[] = [
      testTurn({
        turnId: 't1',
        turnOrdinal: 1,
        userText: 'both',
        segments: [
          {
            id: 's0',
            speakerCharacterId: 'char-a',
            receives: [{ id: 'r0', content: 'Alice says hi' }],
            activeReceiveIndex: 0,
          },
          {
            id: 's1',
            speakerCharacterId: 'char-b',
            receives: [{ id: 'r1', content: 'Betty says hey' }],
            activeReceiveIndex: 0,
          },
        ],
        activeSegmentIndex: 1,
      }),
    ]
    const out = formatSummarizeTranscript(turns, 'User', 'Bot')
    assert.equal(
      out,
      '<user userName="{{user}}">both</user>\n<assistant charName="{{char}}">Alice says hi</assistant>\n<assistant charName="{{char}}">Betty says hey</assistant>',
    )
  })
})

describe('stripBlockTagsOnTurnSegment', () => {
  it('strips only the targeted segment on multi-segment turn', () => {
    const turn = testTurn({
      turnId: 't2',
      turnOrdinal: 2,
      userText: 'u',
      segments: [
        {
          id: 's0',
          receives: [
            {
              id: 'r0',
              content: 'a<ex-fixture-block>{"a":1}</ex-fixture-block>',
            },
          ],
          activeReceiveIndex: 0,
        },
        {
          id: 's1',
          receives: [
            {
              id: 'r1',
              content: 'b<ex-fixture-block>{"b":2}</ex-fixture-block>',
            },
          ],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 1,
    })
    const out = stripBlockTagsOnTurnSegment(turn, ['ex-fixture-block'], 0)
    assert.equal(out.segments[0]?.receives[0]?.content, 'a')
    assert.match(out.segments[1]?.receives[0]?.content ?? '', /ex-fixture-block/)
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
    const turn = testTurn({
      turnId: 't0',
      turnOrdinal: 0,
      userText: 'TRACK hi',
      receives: [{ id: 'r0', content: 'TRACK ok' }],
    })
    const out = applyOutgoingRegexToSummaryTurn(turn, [rule], 0)
    assert.equal(getTurnUserText(out), 'TRACK hi')
    assert.equal(out.segments[0]?.receives[0]?.content, ' ok')
  })

  it('applies outgoing rules to every segment in group chat turn', () => {
    const turn = testTurn({
      turnId: 't1',
      turnOrdinal: 1,
      userText: 'u',
      segments: [
        {
          id: 's0',
          receives: [{ id: 'r0', content: 'TRACK a' }],
          activeReceiveIndex: 0,
        },
        {
          id: 's1',
          receives: [{ id: 'r1', content: 'TRACK b' }],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 1,
    })
    const out = applyOutgoingRegexToSummaryTurn(turn, [rule], 1)
    assert.equal(out.segments[0]?.receives[0]?.content, ' a')
    assert.equal(out.segments[1]?.receives[0]?.content, ' b')
  })

  it('regexApplyAllTurns ignores skipLastNTurns on recent turns', () => {
    const skipRule: RegexRule = {
      ...rule,
      skipLastNTurns: 3,
      skipLastNTurnsOutgoing: 3,
    }
    const turn = testTurn({
      turnId: 't9',
      turnOrdinal: 9,
      userText: 'u',
      receives: [{ id: 'r0', content: 'TRACK ok' }],
    })
    const skipped = applyOutgoingRegexToSummaryTurn(turn, [skipRule], 10, false)
    assert.equal(skipped.segments[0]?.receives[0]?.content, 'TRACK ok')
    const applied = applyOutgoingRegexToSummaryTurn(turn, [skipRule], 10, true)
    assert.equal(applied.segments[0]?.receives[0]?.content, ' ok')
  })
})
