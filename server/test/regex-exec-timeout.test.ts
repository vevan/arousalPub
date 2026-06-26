import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { replaceRegexWithTimeout } from '../src/regex-exec-timeout.js'

describe('replaceRegexWithTimeout', () => {
  it('replaces on simple pattern', () => {
    const r = replaceRegexWithTimeout('foo', 'g', 'foo bar foo', 'baz')
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.text, 'baz bar baz')
  })

  it('returns error on invalid pattern', () => {
    const r = replaceRegexWithTimeout('(', 'g', 'foo', 'bar')
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'regex_exec_error')
  })
})
