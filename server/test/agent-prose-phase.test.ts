import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideToolCallsProseAction,
  normalizeAgentToolPhase,
} from '../src/agent/agent-prose-phase.js'

describe('normalizeAgentToolPhase', () => {
  it('accepts read/write only', () => {
    assert.equal(normalizeAgentToolPhase('read'), 'read')
    assert.equal(normalizeAgentToolPhase('write'), 'write')
    assert.equal(normalizeAgentToolPhase('mutate'), undefined)
    assert.equal(normalizeAgentToolPhase(undefined), undefined)
  })
})

describe('decideToolCallsProseAction', () => {
  const writeToolNames = new Set(['fixture_write'])

  it('keeps after prose committed', () => {
    assert.equal(
      decideToolCallsProseAction({
        proseCommitted: true,
        contentChars: 10,
        toolNames: ['fixture_write'],
        writeToolNames,
      }),
      'keep',
    )
    assert.equal(
      decideToolCallsProseAction({
        proseCommitted: true,
        contentChars: 10,
        toolNames: ['lore_search'],
        writeToolNames,
      }),
      'keep',
    )
  })

  it('commits when write tools follow streamed content', () => {
    assert.equal(
      decideToolCallsProseAction({
        proseCommitted: false,
        contentChars: 42,
        toolNames: ['fixture_write'],
        writeToolNames,
      }),
      'commit',
    )
  })

  it('clears for read tools before pre-prose reads done', () => {
    assert.equal(
      decideToolCallsProseAction({
        proseCommitted: false,
        contentChars: 42,
        toolNames: ['lore_search', 'memory_search'],
        writeToolNames,
        preProseReadsDone: false,
      }),
      'clear',
    )
  })

  it('commits read tools after pre-prose reads done (weak model prose then more reads)', () => {
    assert.equal(
      decideToolCallsProseAction({
        proseCommitted: false,
        contentChars: 42,
        toolNames: ['fixture_read_tool'],
        writeToolNames,
        preProseReadsDone: true,
      }),
      'commit',
    )
  })

  it('clears when write tools but no content yet', () => {
    assert.equal(
      decideToolCallsProseAction({
        proseCommitted: false,
        contentChars: 0,
        toolNames: ['fixture_write'],
        writeToolNames,
      }),
      'clear',
    )
  })
})
