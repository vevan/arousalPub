import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stripJsonComments } from './config-jsonc.js'

describe('stripJsonComments', () => {
  it('removes line comments outside strings', () => {
    const raw = `{
  "a": 1, // comment
  "b": "x // not comment"
}`
    const parsed = JSON.parse(stripJsonComments(raw)) as { a: number; b: string }
    assert.equal(parsed.a, 1)
    assert.equal(parsed.b, 'x // not comment')
  })

  it('removes block comments', () => {
    const raw = `{ /* head */ "ok": true }`
    assert.deepEqual(JSON.parse(stripJsonComments(raw)), { ok: true })
  })
})
