import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildScanText } from '../src/lore-scan.js'

describe('buildScanText', () => {
  it('joins plain memory/history without stripping angle brackets', () => {
    const corpus = buildScanText(
      '用户问',
      '召回含 <hidden>秘文</hidden> 的正文',
      '历史含 <note>标注</note>',
    )
    assert.match(corpus, /用户问/)
    assert.match(corpus, /<hidden>秘文<\/hidden>/)
    assert.match(corpus, /<note>标注<\/note>/)
  })

  it('trims and drops empty parts', () => {
    assert.equal(buildScanText('  a  ', '', null), 'a')
  })
})
