import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LOREBOOK_KEYWORD_TOPK_MAX,
  LOREBOOK_KEYWORD_TOPK_MIN,
  LOREBOOK_SETTINGS_DEFAULTS,
  LOREBOOK_VECTOR_TOPK_MAX,
  LOREBOOK_VECTOR_TOPK_MIN,
  lorebookSettingsOverrideFromEffective,
  normalizeLorebookSettings,
  resolveLorebookSettings,
} from './lorebook-settings.js'

describe('normalizeLorebookSettings keywordTopK', () => {
  it('uses default 64 for empty input', () => {
    const s = normalizeLorebookSettings(null)
    assert.equal(s.keywordTopK, LOREBOOK_SETTINGS_DEFAULTS.keywordTopK)
    assert.equal(s.keywordTopK, 64)
  })

  it('clamps keywordTopK to [1, 64]', () => {
    assert.equal(normalizeLorebookSettings({ keywordTopK: 0 }).keywordTopK, LOREBOOK_KEYWORD_TOPK_MIN)
    assert.equal(normalizeLorebookSettings({ keywordTopK: 999 }).keywordTopK, LOREBOOK_KEYWORD_TOPK_MAX)
    assert.equal(normalizeLorebookSettings({ keywordTopK: 12.9 }).keywordTopK, 12)
  })

  it('keeps vectorTopK independent', () => {
    const s = normalizeLorebookSettings({ keywordTopK: 5, vectorTopK: 3, vectorEnabled: true })
    assert.equal(s.keywordTopK, 5)
    assert.equal(s.vectorTopK, 3)
  })

  it('clamps vectorTopK to [1, 20]', () => {
    assert.equal(normalizeLorebookSettings({ vectorTopK: 0 }).vectorTopK, LOREBOOK_VECTOR_TOPK_MIN)
    assert.equal(normalizeLorebookSettings({ vectorTopK: 99 }).vectorTopK, LOREBOOK_VECTOR_TOPK_MAX)
  })
})

describe('resolveLorebookSettings keywordTopK', () => {
  it('merges conversation override with global', () => {
    const global = normalizeLorebookSettings({ keywordTopK: 64, vectorTopK: 5 })
    const effective = resolveLorebookSettings(global, { keywordTopK: 10 })
    assert.equal(effective.keywordTopK, 10)
    assert.equal(effective.vectorTopK, 5)
  })
})

describe('lorebookSettingsOverrideFromEffective keywordTopK', () => {
  it('includes keywordTopK when different from global', () => {
    const global = normalizeLorebookSettings({ keywordTopK: 64 })
    const effective = normalizeLorebookSettings({ keywordTopK: 8 })
    const o = lorebookSettingsOverrideFromEffective(effective, global)
    assert.deepEqual(o, { keywordTopK: 8 })
  })
})
