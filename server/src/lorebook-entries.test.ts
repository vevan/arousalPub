import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOREBOOK_ENTRY_ID_RE } from './lorebook-entries.js'
import type { LorebookEntry } from './lorebook-types.js'

describe('lorebook entry id pattern', () => {
  it('accepts entry- prefixed ids', () => {
    assert.equal(LOREBOOK_ENTRY_ID_RE.test('entry-abc12345'), true)
    assert.equal(LOREBOOK_ENTRY_ID_RE.test(''), false)
  })
})

describe('LorebookEntry shape', () => {
  it('allows vector triggerMode', () => {
    const e: LorebookEntry = {
      id: 'entry-test',
      groupId: 'group-main',
      title: 't',
      content: 'c',
      enabled: true,
      order: 0,
      keys: ['k'],
      constant: false,
      triggerMode: 'vector',
      priority: 100,
      createdAt: 't',
      updatedAt: 't',
    }
    assert.equal(e.triggerMode, 'vector')
  })
})
