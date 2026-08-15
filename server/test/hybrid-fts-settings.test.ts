import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catalogEntryForProfile } from '../src/hybrid-fts-catalog.js'
import {
  formatHybridFtsSpec,
  normalizeHybridFtsDictVariant,
  normalizeHybridFtsSettings,
  parseHybridFtsSpec,
} from '../src/hybrid-fts-settings.js'

describe('hybrid-fts-catalog', () => {
  it('jieba has three variants', () => {
    const entry = catalogEntryForProfile('zh-jieba')
    assert.equal(entry.requiresDict, true)
    assert.equal(entry.variants.length, 3)
  })

  it('lindera lists multi-language zip packs pinned to v3.0.7', () => {
    const entry = catalogEntryForProfile('lindera')
    assert.equal(entry.requiresDict, true)
    assert.equal(entry.dictFamily, 'lindera')
    assert.equal(entry.variants.length, 6)
    const ipadic = entry.variants.find((v) => v.id === 'ipadic')
    assert.ok(ipadic)
    assert.equal(ipadic!.artifactKind, 'zip')
    assert.match(ipadic!.downloadUrl, /v3\.0\.7\/lindera-ipadic-3\.0\.7\.zip$/)
    assert.equal(ipadic!.languageHint, 'ja')
  })

  it('ngram does not require dict', () => {
    assert.equal(catalogEntryForProfile('zh-ngram').requiresDict, false)
  })
})

describe('normalizeHybridFtsDictVariant', () => {
  it('defaults unknown jieba variant to default', () => {
    assert.equal(normalizeHybridFtsDictVariant('huge', 'zh-jieba'), 'default')
  })

  it('defaults unknown lindera kind to ipadic', () => {
    assert.equal(normalizeHybridFtsDictVariant('huge', 'lindera'), 'ipadic')
  })

  it('rejects jieba size names under lindera profile', () => {
    assert.equal(normalizeHybridFtsDictVariant('big', 'lindera'), 'ipadic')
  })
})

describe('parseHybridFtsSpec', () => {
  it('accepts profile-only jieba spec', () => {
    assert.equal(parseHybridFtsSpec('zh-jieba').profile, 'zh-jieba')
    assert.equal(parseHybridFtsSpec('zh-jieba').dictVariant, 'default')
  })

  it('formats legacy jieba without variant as default variant', () => {
    assert.equal(
      formatHybridFtsSpec(parseHybridFtsSpec('zh-jieba')),
      'zh-jieba:default',
    )
  })

  it('parses lindera:ipadic', () => {
    const s = parseHybridFtsSpec('lindera:ipadic')
    assert.equal(s.profile, 'lindera')
    assert.equal(s.dictVariant, 'ipadic')
    assert.equal(formatHybridFtsSpec(s), 'lindera:ipadic')
  })

  it('normalizes lindera profile-only to ipadic', () => {
    assert.deepEqual(normalizeHybridFtsSettings({ profile: 'lindera' }), {
      profile: 'lindera',
      dictVariant: 'ipadic',
    })
  })
})
