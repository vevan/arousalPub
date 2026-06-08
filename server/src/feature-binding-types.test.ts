import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ensureChatBindingFromActivePreset,
  normalizeFeatureBindingsOnRead,
  parseFeatureBinding,
  parseFeatureBindingsFromDisk,
  upsertChatGlobalBinding,
  validateFeatureBindingUniqueness,
} from './feature-binding-types.js'

describe('feature-binding-types', () => {
  it('parses valid binding', () => {
    const r = parseFeatureBinding({
      id: 'f0000001',
      featureType: 'chat',
      featureRefId: 'global',
      apiConfigId: 'a1b2c3d4',
      updatedAt: '2026-06-08T00:00:00.000Z',
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.binding.featureType, 'chat')
      assert.equal(r.binding.apiConfigId, 'a1b2c3d4')
    }
  })

  it('rejects duplicate uniqueness', () => {
    const bindings = [
      {
        id: '1',
        featureType: 'chat' as const,
        featureRefId: 'global',
        apiConfigId: 'a',
        updatedAt: 't',
      },
      {
        id: '2',
        featureType: 'chat' as const,
        featureRefId: 'global',
        apiConfigId: 'b',
        updatedAt: 't',
      },
    ]
    const v = validateFeatureBindingUniqueness(bindings)
    assert.equal(v.ok, false)
  })

  it('lazy-adds chat binding from activePresetId', () => {
    const next = ensureChatBindingFromActivePreset([], 'preset-a')
    assert.equal(next.length, 1)
    assert.equal(next[0]?.featureType, 'chat')
    assert.equal(next[0]?.apiConfigId, 'preset-a')
  })

  it('upserts chat global binding', () => {
    const first = upsertChatGlobalBinding([], 'p1')
    const second = upsertChatGlobalBinding(first, 'p2')
    assert.equal(second.length, 1)
    assert.equal(second[0]?.apiConfigId, 'p2')
  })

  it('drops legacy plugin bindings on disk parse', () => {
    const parsed = parseFeatureBindingsFromDisk([
      {
        id: 'f0',
        featureType: 'plugin',
        featureRefId: 'curated-memory',
        apiConfigId: 'old',
        updatedAt: 't',
      },
      {
        id: 'f2',
        featureType: 'chat',
        featureRefId: 'global',
        apiConfigId: 'p1',
        updatedAt: 't',
      },
    ])
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0]?.featureType, 'chat')
  })

  it('drops legacy summary bindings on disk parse', () => {
    const parsed = parseFeatureBindingsFromDisk([
      {
        id: 'f1',
        featureType: 'summary',
        featureRefId: 'global',
        apiConfigId: 'old',
        updatedAt: 't',
      },
      {
        id: 'f2',
        featureType: 'chat',
        featureRefId: 'global',
        apiConfigId: 'p1',
        updatedAt: 't',
      },
    ])
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0]?.featureType, 'chat')
  })

  it('prefers chat binding over activePresetId on read', () => {
    const { bindings, activePresetId } = normalizeFeatureBindingsOnRead(
      [
        {
          id: 'f1',
          featureType: 'chat',
          featureRefId: 'global',
          apiConfigId: 'from-binding',
          updatedAt: 't',
        },
      ],
      'from-active',
      new Set(['from-binding', 'from-active']),
    )
    assert.equal(activePresetId, 'from-binding')
    assert.equal(bindings[0]?.apiConfigId, 'from-binding')
  })
})
