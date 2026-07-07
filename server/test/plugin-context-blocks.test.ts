import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fillPromptLayoutPlaceholders } from '../src/plugin-assemble-prompt.js'
import { parseContextBlockSpecs } from '../src/plugin-context-blocks-resolve.js'
import { stripBlockTagsFromAssistant } from '../src/plugin-summarize-format.js'

describe('stripBlockTagsFromAssistant', () => {
  it('strips plugin block tags from assistant text', () => {
    const text =
      'narrative<ex-trace-keeper>{"a":1}</ex-trace-keeper> tail'
    const out = stripBlockTagsFromAssistant(text, ['ex-trace-keeper'])
    assert.equal(out, 'narrative tail')
  })
})

describe('parseContextBlockSpecs', () => {
  it('parses lorebook.entries block', () => {
    const specs = parseContextBlockSpecs([
      {
        source: 'lorebook.entries',
        blockId: 'sidecars',
        lorebookId: 'lb-1',
        entryIds: ['e1', 'e2'],
      },
    ])
    assert.equal(specs.length, 1)
    assert.equal(specs[0]?.source, 'lorebook.entries')
  })

  it('parses conversation.transcript block', () => {
    const specs = parseContextBlockSpecs([
      {
        source: 'conversation.transcript',
        blockId: 'history',
        fromTurn: 0,
        toTurn: 5,
        regexRuleIds: ['r1'],
        stripBlockTagsOnToTurn: ['ex-trace-keeper'],
      },
    ])
    assert.deepEqual(specs[0], {
      source: 'conversation.transcript',
      blockId: 'history',
      fromTurn: 0,
      toTurn: 5,
      regexRuleIds: ['r1'],
      regexApplyAllTurns: false,
      tailOrdinal: undefined,
      stripBlockTagsOnToTurn: ['ex-trace-keeper'],
    })
  })
})

describe('fillPromptLayoutPlaceholders', () => {
  it('fills blocks and plugin settings', () => {
    const out = fillPromptLayoutPlaceholders(
      {
        messages: [
          {
            role: 'system',
            content: '{{blocks.ref}}{{plugin.systemPromptTemplate}}',
          },
          { role: 'user', content: '{{blocks.history}}' },
        ],
      },
      { ref: 'REF', history: 'HIST' },
      { systemPromptTemplate: 'INSTR' },
    )
    assert.equal(out[0]?.content, 'REFINSTR')
    assert.equal(out[1]?.content, 'HIST')
  })

  it('empty block placeholder yields blank slot (assemble skips before macro)', () => {
    const out = fillPromptLayoutPlaceholders(
      {
        messages: [
          { role: 'system', content: '{{blocks.reference}}' },
          { role: 'user', content: '{{blocks.history}}' },
        ],
      },
      { reference: '', history: 'HIST' },
    )
    assert.equal(out[0]?.content, '')
    assert.equal(out[1]?.content, 'HIST')
  })
})
