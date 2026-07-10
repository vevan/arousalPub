import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  pickUniqueLorebookName,
  resolveAutoLorebookName,
} from '../src/plugin-lorebook-ensure.js'

const sampleVars = {
  conversationTitle: '我的冒险',
  conversationId: 'b432b295',
  char: 'Alice',
}

describe('resolveAutoLorebookName', () => {
  it('replaces conversationTitle placeholder', () => {
    assert.equal(
      resolveAutoLorebookName('${conversationTitle}-summary', sampleVars),
      '我的冒险-summary',
    )
  })

  it('replaces conversationId and char placeholders', () => {
    assert.equal(
      resolveAutoLorebookName('LTM - ${char} - ${conversationId}', sampleVars),
      'LTM - Alice - b432b295',
    )
  })

  it('leaves unknown placeholders literal', () => {
    assert.equal(
      resolveAutoLorebookName('${user}-summary', sampleVars),
      '${user}-summary',
    )
  })

  it('falls back when template empty', () => {
    assert.equal(resolveAutoLorebookName('', sampleVars), '我的冒险-summary')
  })

  it('uses 未命名对话 when title empty', () => {
    assert.equal(
      resolveAutoLorebookName('${conversationTitle}', {
        conversationTitle: '',
        conversationId: 'abc',
        char: '',
      }),
      '未命名对话',
    )
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
