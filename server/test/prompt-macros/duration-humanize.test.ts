import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  humanizeDurationMs,
  humanizeIdleDuration,
  humanizeTimeDiff,
  parseMacroTimeValue,
} from '../../src/prompt-macros/duration-humanize.js'

describe('parseMacroTimeValue', () => {
  it('parses ISO8601', () => {
    const d = parseMacroTimeValue('2023-01-01T12:00:00.000Z')
    assert.ok(d)
    assert.equal(d!.toISOString(), '2023-01-01T12:00:00.000Z')
  })
})

describe('humanizeTimeDiff', () => {
  it('returns suffix form for three hour gap', () => {
    const out = humanizeTimeDiff(
      '2023-01-01T15:00:00.000Z',
      '2023-01-01T12:00:00.000Z',
      'en',
    )
    assert.match(out, /hour/i)
  })
})

describe('humanizeIdleDuration', () => {
  it('returns just now when reference missing', () => {
    assert.equal(humanizeIdleDuration(undefined, new Date(), 'en'), 'just now')
    assert.equal(humanizeIdleDuration(undefined, new Date(), 'zh-CN'), '刚刚')
  })

  it('humanizes elapsed time since reference', () => {
    const now = new Date('2023-01-01T13:00:00.000Z')
    const out = humanizeIdleDuration(
      '2023-01-01T12:00:00.000Z',
      now,
      'en',
    )
    assert.match(out, /hour/i)
  })
})

describe('humanizeDurationMs', () => {
  it('uses just now threshold without suffix', () => {
    assert.equal(humanizeDurationMs(5000, 'en', false), 'just now')
  })
})
