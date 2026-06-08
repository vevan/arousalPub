import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ApiPreset, ApiSettingsDocument } from './api-settings-file.js'
import {
  resolvePluginCompleteApi,
  resolvePluginCompleteApiFromSources,
} from './plugin-api-resolve.js'

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
    activePresetId: 'preset-a',
    presets: [mockPreset('preset-a'), mockPreset('preset-b')],
    ...partial,
  }
}

describe('resolvePluginCompleteApi', () => {
  it('rejects empty pluginId', async () => {
    const hit = await resolvePluginCompleteApi({ pluginId: '  ' })
    assert.equal(hit.ok, false)
    if (!hit.ok) {
      assert.equal(hit.code, 'api_config_not_found')
    }
  })
})

describe('resolvePluginCompleteApiFromSources', () => {
  const settings = mockSettings()

  it('rejects empty pluginId', () => {
    const hit = resolvePluginCompleteApiFromSources(
      { pluginId: '  ' },
      { settings, pluginSettings: {} },
    )
    assert.equal(hit.ok, false)
  })

  it('uses explicit apiConfigId when preset exists', () => {
    const hit = resolvePluginCompleteApiFromSources(
      { pluginId: 'curated-memory', apiConfigId: 'preset-b' },
      { settings, pluginSettings: { apiConfigId: 'preset-a' } },
    )
    assert.equal(hit.ok, true)
    if (hit.ok) {
      assert.equal(hit.resolved.apiConfigId, 'preset-b')
      assert.equal(hit.resolved.source, 'plugin_settings')
    }
  })

  it('rejects explicit apiConfigId when preset missing', () => {
    const hit = resolvePluginCompleteApiFromSources(
      { pluginId: 'curated-memory', apiConfigId: 'missing' },
      { settings, pluginSettings: {} },
    )
    assert.equal(hit.ok, false)
  })

  it('prefers conversation plugin binding over plugin settings', () => {
    const hit = resolvePluginCompleteApiFromSources(
      { pluginId: 'curated-memory', conversationId: 'abc12345' },
      {
        settings,
        conversationApiPreset: {
          plugins: { 'curated-memory': { apiConfigId: 'preset-b' } },
        },
        pluginSettings: { apiConfigId: 'preset-a' },
      },
    )
    assert.equal(hit.ok, true)
    if (hit.ok) {
      assert.equal(hit.resolved.apiConfigId, 'preset-b')
      assert.equal(hit.resolved.source, 'conversation')
    }
  })

  it('falls back to plugin settings apiConfigId', () => {
    const hit = resolvePluginCompleteApiFromSources(
      { pluginId: 'curated-memory' },
      {
        settings,
        pluginSettings: { apiConfigId: 'preset-a' },
      },
    )
    assert.equal(hit.ok, true)
    if (hit.ok) {
      assert.equal(hit.resolved.apiConfigId, 'preset-a')
      assert.equal(hit.resolved.source, 'plugin_settings')
    }
  })

  it('returns not found when settings missing and no explicit id', () => {
    const hit = resolvePluginCompleteApiFromSources(
      { pluginId: 'curated-memory' },
      { settings: null, pluginSettings: { apiConfigId: 'preset-a' } },
    )
    assert.equal(hit.ok, false)
  })
})
