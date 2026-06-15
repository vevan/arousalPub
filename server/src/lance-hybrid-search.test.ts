import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chineseFtsIndexOptions,
  hybridRelevanceScore,
} from './lance-hybrid-search.js'

describe('chineseFtsIndexOptions', () => {
  it('uses ngram tokenizer without English stemming', () => {
    const opts = chineseFtsIndexOptions()
    assert.equal(opts.baseTokenizer, 'ngram')
    assert.equal(opts.stem, false)
    assert.equal(opts.removeStopWords, false)
    assert.equal(opts.ngramMinLength, 2)
    assert.equal(opts.ngramMaxLength, 3)
  })
})

describe('hybridRelevanceScore', () => {
  it('prefers RRF score when present', () => {
    assert.equal(
      hybridRelevanceScore({ _relevance_score: 0.5, _distance: 0.1 }),
      0.5,
    )
  })

  it('falls back to vector distance', () => {
    assert.equal(hybridRelevanceScore({ _distance: 1 }), 0.5)
  })
})
