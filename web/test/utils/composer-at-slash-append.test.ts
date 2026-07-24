import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setAtSlashDisplayName } from '../../src/utils/composer-at-slash-append.js'

describe('setAtSlashDisplayName', () => {
  it('prepends /@ when absent', () => {
    assert.equal(setAtSlashDisplayName('hello', 'Alice'), '/@ Alice\nhello')
    assert.equal(setAtSlashDisplayName('', 'Alice'), '/@ Alice')
  })

  it('replaces existing /@ name (single only)', () => {
    assert.equal(
      setAtSlashDisplayName('/@ Alice\nhi', 'Betty', ['Alice', 'Betty']),
      '/@ Betty\nhi',
    )
  })

  it('is idempotent for the same sole name', () => {
    assert.equal(
      setAtSlashDisplayName('/@ Alice', 'Alice', ['Alice']),
      '/@ Alice',
    )
  })

  it('keeps remainder after replacing name', () => {
    assert.equal(
      setAtSlashDisplayName('/@ Alice please', 'Betty', ['Alice', 'Betty']),
      '/@ Betty please',
    )
  })
})
