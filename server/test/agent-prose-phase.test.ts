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
  const writeToolNames = new Set(['trace_patch', 'fixture_write'])

  it('keeps after prose committed', () => {
    assert.equal(
      decideToolCallsProseAction({
        proseCommitted: true,
        contentChars: 10,
        toolNames: ['trace_patch'],
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
        toolNames: ['trace_patch'],
        writeToolNames,
      }),
      'commit',
    )
  })

  it('clears for read tools before commit', () => {
    assert.equal(
      decideToolCallsProseAction({
        proseCommitted: false,
        contentChars: 42,
        toolNames: ['lore_search', 'memory_search'],
        writeToolNames,
      }),
      'clear',
    )
  })

  it('clears when write tools but no content yet', () => {
    assert.equal(
      decideToolCallsProseAction({
        proseCommitted: false,
        contentChars: 0,
        toolNames: ['trace_patch'],
        writeToolNames,
      }),
      'clear',
    )
  })
})
