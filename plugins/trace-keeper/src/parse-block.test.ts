import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { diagnoseAssistantTrace, extractTraceKeeperState } from './parse-block.js'

describe('diagnoseAssistantTrace', () => {
  it('returns no_block when content empty or no tag', () => {
    assert.equal(diagnoseAssistantTrace('').kind, 'no_block')
    assert.equal(diagnoseAssistantTrace('hello world').kind, 'no_block')
  })

  it('returns empty_block when tags have no inner text', () => {
    assert.equal(
      diagnoseAssistantTrace('x<ex-trace-keeper></ex-trace-keeper>').kind,
      'empty_block',
    )
  })

  it('returns json_parse_failed for invalid json', () => {
    const d = diagnoseAssistantTrace(
      'reply<ex-trace-keeper>{not json}</ex-trace-keeper>',
    )
    assert.equal(d.kind, 'json_parse_failed')
    if (d.kind === 'json_parse_failed') {
      assert.ok(d.detail && d.detail.length > 0)
    }
  })

  it('returns valid_json when parse succeeds', () => {
    assert.equal(
      diagnoseAssistantTrace(
        'a<ex-trace-keeper>{"scene":{"location":"x"}}</ex-trace-keeper>',
      ).kind,
      'valid_json',
    )
  })

  it('valid_json when later block is valid even if earlier invalid', () => {
    assert.equal(
      diagnoseAssistantTrace(
        '<ex-trace-keeper>{bad}</ex-trace-keeper><ex-trace-keeper>{"ok":1}</ex-trace-keeper>',
      ).kind,
      'valid_json',
    )
  })
})

describe('extractTraceKeeperState', () => {
  it('parses last valid block', () => {
    assert.deepEqual(
      extractTraceKeeperState('hello<ex-trace-keeper>{"x":1}</ex-trace-keeper>'),
      { x: 1 },
    )
  })
})
