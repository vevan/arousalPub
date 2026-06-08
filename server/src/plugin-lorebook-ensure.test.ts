import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  pickUniqueLorebookName,
  resolveAutoLorebookName,
} from './plugin-lorebook-ensure.js'

describe('resolveAutoLorebookName', () => {
  it('replaces conversationTitle macro', () => {
    assert.equal(
      resolveAutoLorebookName('{{conversationTitle}}-summary', '我的冒险'),
      '我的冒险-summary',
    )
  })

  it('falls back when template empty', () => {
    assert.equal(resolveAutoLorebookName('', 'RP'), 'RP-summary')
  })
})

describe('pickUniqueLorebookName', () => {
  it('returns base when unique', () => {
    assert.equal(
      pickUniqueLorebookName('我的冒险-summary', new Set(), 'b432b295'),
      '我的冒险-summary',
    )
  })

  it('appends conversation id when base name taken', () => {
    assert.equal(
      pickUniqueLorebookName(
        '我的冒险-summary',
        new Set(['我的冒险-summary']),
        'b432b295',
      ),
      '我的冒险-summary-b432b295',
    )
  })
})
