import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import { buildSeparateDialogueMessages } from '../src/separate-dialogue.js'

import { buildSeparateRegenerateMessages } from '../src/tracker-prompt.js'

import type { TraceBundle } from '../src/constants.js'

const SAMPLE_BUNDLE: TraceBundle = {
  id: 'test',
  label: 'test',
  sampleState: { mood: 'calm' },
  template: '<div></div>',
  stylesheet: '',
  separateSystemPromptTemplate: 'Custom separate instruction.',
}

function turnRow(
  turnOrdinal: number,
  userText: string,
  content: string,
  receiveId = `r${turnOrdinal}`,
) {
  return {
    turnOrdinal,
    userText,
    activeSegmentIndex: 0,
    segments: [
      {
        receives: [{ id: receiveId, content }],
        activeReceiveIndex: 0,
      },
    ],
  }
}

describe('buildSeparateDialogueMessages', () => {
  it('builds multi-turn window and strips block on target only', () => {
    const tail = [
      turnRow(
        1,
        'hello',
        'hi<ex-trace-keeper>{"mood":"a"}</ex-trace-keeper>',
        'r1',
      ),
      turnRow(
        2,
        'next',
        'reply<ex-trace-keeper>{"mood":"b"}</ex-trace-keeper>',
        'r2',
      ),
    ]

    const messages = buildSeparateDialogueMessages(tail, 2, 2)
    assert.deepEqual(
      messages.map((m) => m.role),
      ['user', 'assistant', 'user', 'assistant'],
    )
    assert.match(messages[1]!.content, /ex-trace-keeper/)
    assert.doesNotMatch(messages[3]!.content, /ex-trace-keeper/)
  })

  it('respects window size', () => {
    const tail = [
      turnRow(1, 'a', 'A', 'r1'),
      turnRow(2, 'b', 'B', 'r2'),
      turnRow(3, 'c', 'C', 'r3'),
    ]
    const messages = buildSeparateDialogueMessages(tail, 3, 1)
    assert.deepEqual(
      messages.map((m) => m.content),
      ['c', 'C'],
    )
  })

  it('strips block on explicit target segment, not active segment', () => {
    const tail = [
      {
        turnOrdinal: 2,
        userText: 'both',
        activeSegmentIndex: 1,
        segments: [
          {
            receives: [
              {
                id: 'r0',
                content: 'Alice<ex-trace-keeper>{"mood":"a"}</ex-trace-keeper>',
              },
            ],
            activeReceiveIndex: 0,
          },
          {
            receives: [
              {
                id: 'r1',
                content: 'Betty<ex-trace-keeper>{"mood":"b"}</ex-trace-keeper>',
              },
            ],
            activeReceiveIndex: 0,
          },
        ],
      },
    ]
    const messages = buildSeparateDialogueMessages(tail, 2, 1, 0)
    assert.equal(messages.length, 3)
    assert.doesNotMatch(messages[1]!.content, /ex-trace-keeper/)
    assert.match(messages[2]!.content, /ex-trace-keeper/)
  })
})

describe('buildSeparateRegenerateMessages', () => {
  it('places system after dialogue and uses separate prompt', () => {
    const tail = [turnRow(1, 'u1', 'a1', 'r1')]
    const messages = buildSeparateRegenerateMessages(tail, 1, 1, SAMPLE_BUNDLE)
    assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'system'])
    assert.equal(messages[0]!.content, 'u1')
    assert.equal(messages[1]!.content, 'a1')
    assert.match(messages[2]!.content, /Custom separate instruction/)
    assert.match(messages[2]!.content, /JSON template/)
    assert.match(messages[2]!.content, /"mood": "calm"/)
  })
})
