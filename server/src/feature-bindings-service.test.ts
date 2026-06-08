import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeFeatureBindingsIntoSettingsPut } from './feature-bindings-service.js'

describe('mergeFeatureBindingsIntoSettingsPut', () => {
  it('syncs chat binding when incoming omitted', () => {
    const next = mergeFeatureBindingsIntoSettingsPut(
      [],
      undefined,
      'preset-a',
      '2026-06-08T00:00:00.000Z',
    )
    assert.equal(next.length, 1)
    assert.equal(next[0]?.featureType, 'chat')
    assert.equal(next[0]?.apiConfigId, 'preset-a')
  })

  it('upserts rag_generate binding from put body', () => {
    const next = mergeFeatureBindingsIntoSettingsPut(
      [],
      [
        {
          featureType: 'rag_generate',
          featureRefId: 'global',
          apiConfigId: 'preset-b',
        },
      ],
      'preset-a',
      '2026-06-08T00:00:00.000Z',
    )
    assert.equal(next.length, 2)
    assert.ok(next.some((b) => b.featureType === 'rag_generate'))
    assert.ok(next.some((b) => b.featureType === 'chat'))
  })

  it('rejects plugin binding from put body', () => {
    assert.throws(
      () =>
        mergeFeatureBindingsIntoSettingsPut(
          [],
          [
            {
              featureType: 'plugin',
              featureRefId: 'curated-memory',
              apiConfigId: 'preset-b',
            },
          ],
          'preset-a',
          '2026-06-08T00:00:00.000Z',
        ),
      /feature_binding_type_invalid/,
    )
  })
})
