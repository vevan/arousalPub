import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { turnReceivesContentUnchanged } from '../src/turn-plugin-sync-from-assistant.js'

describe('turnReceivesContentUnchanged', () => {
  it('true when id+content match in order', () => {
    assert.equal(
      turnReceivesContentUnchanged(
        [
          { id: 'a', content: 'one' },
          { id: 'b', content: 'two' },
        ],
        [
          { id: 'a', content: 'one' },
          { id: 'b', content: 'two' },
        ],
      ),
      true,
    )
  })

  it('false when only length of receives differs (swipe does not change this)', () => {
    assert.equal(
      turnReceivesContentUnchanged(
        [{ id: 'a', content: 'one' }],
        [
          { id: 'a', content: 'one' },
          { id: 'b', content: 'two' },
        ],
      ),
      false,
    )
  })

  it('false when content edited', () => {
    assert.equal(
      turnReceivesContentUnchanged(
        [{ id: 'a', content: 'one' }],
        [{ id: 'a', content: 'edited' }],
      ),
      false,
    )
  })

  it('true for empty vs empty', () => {
    assert.equal(turnReceivesContentUnchanged([], []), true)
    assert.equal(turnReceivesContentUnchanged(undefined, []), true)
  })
})
