import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catalogEntryForProfile } from './hybrid-fts-catalog.js'
import {
  formatHybridFtsSpec,
  normalizeHybridFtsDictVariant,
  parseHybridFtsSpec,
} from './hybrid-fts-settings.js'

describe('hybrid-fts-catalog', () => {
  it('jieba has three variants', () => {
    const entry = catalogEntryForProfile('zh-jieba')
    assert.equal(entry.requiresDict, true)
    assert.equal(entry.variants.length, 3)
  })

  it('ngram does not require dict', () => {
    assert.equal(catalogEntryForProfile('zh-ngram').requiresDict, false)
  })
})

describe('normalizeHybridFtsDictVariant', () => {
  it('defaults unknown to default', () => {
    assert.equal(normalizeHybridFtsDictVariant('huge'), 'default')
  })
})

describe('parseHybridFtsSpec legacy', () => {
  it('accepts profile-only spec', () => {
    assert.equal(parseHybridFtsSpec('zh-jieba').profile, 'zh-jieba')
    assert.equal(parseHybridFtsSpec('zh-jieba').dictVariant, 'default')
  })

  it('formats legacy jieba without variant as default variant', () => {
    assert.equal(
      formatHybridFtsSpec(parseHybridFtsSpec('zh-jieba')),
      'zh-jieba:default',
    )
  })
})
