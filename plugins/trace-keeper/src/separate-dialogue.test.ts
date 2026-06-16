import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import { buildSeparateDialogueMessages } from './separate-dialogue.js'

import { buildSeparateRegenerateMessages } from './tracker-prompt.js'

import type { TraceBundle } from './constants.js'



const SAMPLE_BUNDLE: TraceBundle = {

  id: 'test',

  label: 'test',

  sampleState: { mood: 'calm' },

  template: '<div></div>',

  stylesheet: '',

  separateSystemPromptTemplate: 'Custom separate instruction.',

}



describe('buildSeparateDialogueMessages', () => {

  it('builds multi-turn window and strips block on target only', () => {

    const tail = [

      {

        turnOrdinal: 1,

        activeReceiveIndex: 0,

        userText: 'hello',

        receives: [

          {

            id: 'r1',

            content: 'hi<ex-trace-keeper>{"mood":"a"}</ex-trace-keeper>',

          },

        ],

      },

      {

        turnOrdinal: 2,

        activeReceiveIndex: 0,

        userText: 'next',

        receives: [

          {

            id: 'r2',

            content: 'reply<ex-trace-keeper>{"mood":"b"}</ex-trace-keeper>',

          },

        ],

      },

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

      {

        turnOrdinal: 1,

        activeReceiveIndex: 0,

        userText: 'a',

        receives: [{ id: 'r1', content: 'A' }],

      },

      {

        turnOrdinal: 2,

        activeReceiveIndex: 0,

        userText: 'b',

        receives: [{ id: 'r2', content: 'B' }],

      },

      {

        turnOrdinal: 3,

        activeReceiveIndex: 0,

        userText: 'c',

        receives: [{ id: 'r3', content: 'C' }],

      },

    ]

    const messages = buildSeparateDialogueMessages(tail, 3, 1)

    assert.deepEqual(

      messages.map((m) => m.content),

      ['c', 'C'],

    )

  })

})



describe('buildSeparateRegenerateMessages', () => {

  it('places system after dialogue and uses separate prompt', () => {

    const tail = [

      {

        turnOrdinal: 1,

        activeReceiveIndex: 0,

        userText: 'u1',

        receives: [{ id: 'r1', content: 'a1' }],

      },

    ]

    const messages = buildSeparateRegenerateMessages(tail, 1, 1, SAMPLE_BUNDLE)

    assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'system'])

    assert.equal(messages[0]!.content, 'u1')

    assert.equal(messages[1]!.content, 'a1')

    assert.match(messages[2]!.content, /Custom separate instruction/)

    assert.match(messages[2]!.content, /JSON template/)

    assert.match(messages[2]!.content, /"mood": "calm"/)

  })

})


