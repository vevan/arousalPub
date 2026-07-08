import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ApiPreset, ApiSettingsDocument } from '../src/api-settings-file.js'
import {
  resolveChatApiConfigId,
  resolveFeatureBindingMeta,
  resolvePluginFeatureBindingMeta,
  toResolvedFeatureAudit,
} from '../src/feature-binding-resolve.js'

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
    ...partial,
  }
}

const FIXTURE_PLUGIN = 'fixture-plugin-a'

describe('feature-binding-resolve', () => {
  it('resolves chat from activePresetId when no conversation override', () => {
    const hit = resolveChatApiConfigId(mockSettings())
    assert.equal(hit?.apiConfigId, 'legacy-id')
    assert.equal(hit?.source, 'global')
  })

  it('conversation chat binding wins over activePresetId', () => {
    const hit = resolveChatApiConfigId(mockSettings(), {
      chat: { apiConfigId: 'global-id', temperature: 0.5 },
    })
    assert.equal(hit?.apiConfigId, 'global-id')
    assert.equal(hit?.source, 'conversation')
  })

  it('does not resolve plugin from activePresetId without fallback option', () => {
    const hit = resolvePluginFeatureBindingMeta(mockSettings(), FIXTURE_PLUGIN, {
      fallbackToGlobalDefault: false,
    })
    assert.equal(hit, null)
  })

  it('conversation pluginSettings apiConfigId wins', () => {
    const hit = resolvePluginFeatureBindingMeta(
      mockSettings(),
      FIXTURE_PLUGIN,
      { conversationPluginApiConfigId: 'global-id' },
    )
    assert.equal(hit?.apiConfigId, 'global-id')
    assert.equal(hit?.source, 'conversation')
  })

  it('falls back to global plugin settings apiConfigId', () => {
    const hit = resolvePluginFeatureBindingMeta(
      mockSettings(),
      FIXTURE_PLUGIN,
      { globalPluginApiConfigId: 'legacy-id' },
    )
    assert.equal(hit?.apiConfigId, 'legacy-id')
    assert.equal(hit?.source, 'plugin_settings')
  })

  it('falls back to activePresetId when fallback enabled', () => {
    const hit = resolvePluginFeatureBindingMeta(mockSettings(), FIXTURE_PLUGIN)
    assert.equal(hit?.apiConfigId, 'legacy-id')
    assert.equal(hit?.source, 'global')
  })

  it('toResolvedFeatureAudit strips preset details', () => {
    const audit = toResolvedFeatureAudit({
      featureType: 'chat',
      featureRefId: 'global',
      apiConfigId: 'legacy-id',
      source: 'global',
    })
    assert.deepEqual(audit, {
      featureType: 'chat',
      apiConfigId: 'legacy-id',
      source: 'global',
    })
  })

  it('resolves rag_generate from conversation rag key only', () => {
    const hit = resolveFeatureBindingMeta(mockSettings(), 'rag_generate', {
      conversationApiPreset: {
        rag: { apiConfigId: 'global-id', modelOverride: 'embed-model' },
      },
    })
    assert.equal(hit?.apiConfigId, 'global-id')
    assert.equal(hit?.modelOverride, 'embed-model')
    assert.equal(hit?.source, 'conversation')
  })

  it('does not resolve rag_generate without conversation binding', () => {
    const hit = resolveFeatureBindingMeta(mockSettings(), 'rag_generate')
    assert.equal(hit, null)
  })
})
