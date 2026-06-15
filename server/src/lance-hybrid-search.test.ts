import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ensureHybridFtsIndex,
  ftsIndexOptionsForProfile,
  chineseFtsIndexOptions,
  hybridRelevanceScore,
  toLanceFtsConfig,
} from './lance-hybrid-search.js'
import { formatHybridFtsSpec } from './hybrid-fts-settings.js'

describe('ensureHybridFtsIndex signature', () => {
  it('requires userId as the fifth argument', () => {
    assert.equal(ensureHybridFtsIndex.length, 5)
  })
})

describe('toLanceFtsConfig', () => {
  it('includes jieba/default for zh-jieba profile', () => {
    const cfg = toLanceFtsConfig('zh-jieba')
    assert.equal(cfg.baseTokenizer, 'jieba/default')
  })

  it('matches ftsIndexOptionsForProfile for zh-ngram', () => {
    assert.deepEqual(toLanceFtsConfig('zh-ngram'), ftsIndexOptionsForProfile('zh-ngram'))
  })
})

describe('ftsIndexOptionsForProfile', () => {
  it('uses ngram tokenizer for zh-ngram', () => {
    const opts = ftsIndexOptionsForProfile('zh-ngram')
    assert.equal(opts.baseTokenizer, 'ngram')
    assert.equal(opts.stem, false)
  })

  it('uses jieba/default for zh-jieba', () => {
    const opts = ftsIndexOptionsForProfile('zh-jieba')
    assert.equal(opts.baseTokenizer, 'jieba/default')
  })
})

describe('chineseFtsIndexOptions', () => {
  it('matches zh-ngram profile', () => {
    assert.deepEqual(chineseFtsIndexOptions(), ftsIndexOptionsForProfile('zh-ngram'))
  })
})

describe('formatHybridFtsSpec', () => {
  it('includes dict variant for jieba', () => {
    assert.equal(
      formatHybridFtsSpec({ profile: 'zh-jieba', dictVariant: 'big' }),
      'zh-jieba:big',
    )
  })
})

describe('hybridRelevanceScore', () => {
  it('prefers RRF score when present', () => {
    assert.equal(
      hybridRelevanceScore({ _relevance_score: 0.5, _distance: 0.1 }),
      0.5,
    )
  })
})
