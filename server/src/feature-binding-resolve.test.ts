import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ApiPreset, ApiSettingsDocument } from './api-settings-file.js'
import {
  resolveChatApiConfigId,
  resolveFeatureBindingMeta,
  resolvePluginFeatureBindingMeta,
  toResolvedFeatureAudit,
} from './feature-binding-resolve.js'

function mockPreset(id: string): ApiPreset {
  return {
    id,
    alias: id,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'k',
    model: 'gpt-4o',
    contextLength: null,
    maxTokens: null,
    stream: true,
    temperature: null,
    topP: null,
    topK: null,
    dryMultiplier: null,
    dryBase: null,
    dryAllowedLength: null,
    dryPenaltyLastN: null,
    drySequenceBreakers: [],
    frequencyPenalty: null,
    presencePenalty: null,
    customParamsJson: '',
    showReasoningChain: false,
    requestReasoningChain: false,
  }
}

function mockSettings(
  partial?: Partial<ApiSettingsDocument>,
): ApiSettingsDocument {
  return {
    version: 1,
    savedAt: '2026-06-08T00:00:00.000Z',
    activePresetId: 'legacy-id',
    presets: [mockPreset('legacy-id'), mockPreset('global-id')],
    featureBindings: [
      {
        id: 'f1',
        featureType: 'chat',
        featureRefId: 'global',
        apiConfigId: 'global-id',
        updatedAt: 't',
      },
    ],
    ...partial,
  }
}

describe('feature-binding-resolve', () => {
  it('resolves chat from global binding before legacy activePresetId', () => {
    const hit = resolveChatApiConfigId(mockSettings())
    assert.equal(hit?.apiConfigId, 'global-id')
    assert.equal(hit?.source, 'global')
  })

  it('conversation chat binding wins over global', () => {
    const hit = resolveChatApiConfigId(mockSettings(), {
      chat: { apiConfigId: 'legacy-id', temperature: 0.5 },
    })
    assert.equal(hit?.apiConfigId, 'legacy-id')
    assert.equal(hit?.source, 'conversation')
  })

  it('does not resolve plugin from global featureBindings', () => {
    const hit = resolvePluginFeatureBindingMeta(
      mockSettings({ featureBindings: [] }),
      'curated-memory',
    )
    assert.equal(hit, null)
  })

  it('conversation plugin binding wins', () => {
    const hit = resolvePluginFeatureBindingMeta(
      mockSettings(),
      'curated-memory',
      {
        plugins: { 'curated-memory': { apiConfigId: 'legacy-id' } },
      },
    )
    assert.equal(hit?.apiConfigId, 'legacy-id')
    assert.equal(hit?.source, 'conversation')
  })

  it('falls back to plugin settings apiConfigId', () => {
    const settings = mockSettings({ featureBindings: [] })
    const hit = resolvePluginFeatureBindingMeta(
      settings,
      'curated-memory',
      undefined,
      'legacy-id',
    )
    assert.equal(hit?.apiConfigId, 'legacy-id')
    assert.equal(hit?.source, 'plugin_settings')
  })

  it('toResolvedFeatureAudit strips preset details', () => {
    const audit = toResolvedFeatureAudit({
      featureType: 'chat',
      featureRefId: 'global',
      apiConfigId: 'global-id',
      source: 'global',
    })
    assert.deepEqual(audit, {
      featureType: 'chat',
      apiConfigId: 'global-id',
      source: 'global',
    })
  })

  it('resolves rag_generate from conversation rag key', () => {
    const hit = resolveFeatureBindingMeta(mockSettings(), 'rag_generate', {
      conversationApiPreset: {
        rag: { apiConfigId: 'global-id', modelOverride: 'embed-model' },
      },
    })
    assert.equal(hit?.apiConfigId, 'global-id')
    assert.equal(hit?.modelOverride, 'embed-model')
    assert.equal(hit?.source, 'conversation')
  })
})
