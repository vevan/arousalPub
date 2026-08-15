import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { memoryIndexMatchesEffectiveSettings } from '../../src/utils/memory-index-settings.js'
import {
  resolveEffectiveHybridFtsSettings,
} from '../../src/utils/hybrid-fts-settings.js'

describe('memory index settings identity', () => {
  it('matches a rebuilt builtin index against the resolved effective profile', () => {
    assert.equal(
      memoryIndexMatchesEffectiveSettings(
        {
          embeddingModel: 'builtin:Xenova/paraphrase-multilingual-MiniLM-L12-v2',
          embeddingDimensions: 384,
          embeddingProfile: 'builtin:multilingual-minilm-l12-v2:q8:mean:l2norm:v1',
        },
        {
          embeddingProfile: 'builtin:multilingual-minilm-l12-v2:q8:mean:l2norm:v1',
        },
        'zh-jieba:default',
        { profile: 'zh-jieba', dictVariant: 'default' },
      ),
      true,
    )
  })

  it('rejects a different embedding profile or Hybrid tokenizer spec', () => {
    const stored = {
      embeddingProfile: 'builtin:multilingual-minilm-l12-v2:q8:mean:l2norm:v1',
    }
    const effective = {
      embeddingProfile: 'api:other:model:384:v2',
    }
    assert.equal(
      memoryIndexMatchesEffectiveSettings(
        stored,
        effective,
        'zh-jieba:default',
        { profile: 'zh-jieba', dictVariant: 'default' },
      ),
      false,
    )
    assert.equal(
      memoryIndexMatchesEffectiveSettings(
        stored,
        { embeddingProfile: stored.embeddingProfile },
        'zh-jieba:small',
        { profile: 'zh-jieba', dictVariant: 'default' },
      ),
      false,
    )
  })

  it('keeps an independent Hybrid override stable when the global setting changes', () => {
    const override = { profile: 'en' as const, dictVariant: null }
    const effective = resolveEffectiveHybridFtsSettings(
      { profile: 'zh-jieba', dictVariant: 'default' },
      override,
    )
    const afterGlobalChange = resolveEffectiveHybridFtsSettings(
      { profile: 'lindera', dictVariant: 'ipadic' },
      override,
    )

    assert.deepEqual(afterGlobalChange, effective)
    assert.equal(
      memoryIndexMatchesEffectiveSettings(
        { embeddingProfile: 'api:model:1536:v2' },
        { embeddingProfile: 'api:model:1536:v2' },
        'en',
        afterGlobalChange,
      ),
      true,
    )
  })
})
