import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectApiConfigIdsFromApiPreset,
  extractApiConfigIdFromBinding,
  findGlobalFeatureBindingReferences,
  findKeyReferencesInSettings,
  findPresetReferencesInSettings,
} from './api-config-references.js'
import type { ApiPreset } from './api-settings-file.js'

describe('extractApiConfigIdFromBinding', () => {
  it('reads apiConfigId from binding object', () => {
    assert.equal(
      extractApiConfigIdFromBinding({ apiConfigId: ' preset-1 ' }),
      'preset-1',
    )
    assert.equal(extractApiConfigIdFromBinding({ modelOverride: 'x' }), null)
  })
})

describe('collectApiConfigIdsFromApiPreset', () => {
  it('collects feature keys and plugins', () => {
    const hits = collectApiConfigIdsFromApiPreset({
      chat: { apiConfigId: 'p-chat' },
      rerank: { apiConfigId: 'p-rerank', modelOverride: 'm' },
      plugins: {
        'guidance-generate': { apiConfigId: 'p-plugin' },
      },
      plugin: { apiConfigId: 'p-default' },
    })
    assert.deepEqual(
      hits.sort((a, b) => a.path.localeCompare(b.path)),
      [
        { path: 'chat', apiConfigId: 'p-chat' },
        { path: 'plugin', apiConfigId: 'p-default' },
        { path: 'plugins.guidance-generate', apiConfigId: 'p-plugin' },
        { path: 'rerank', apiConfigId: 'p-rerank' },
      ],
    )
  })
})

describe('findGlobalFeatureBindingReferences', () => {
  it('finds global feature binding references', () => {
    const refs = findGlobalFeatureBindingReferences('keep-me', [
      {
        id: 'f1',
        featureType: 'chat',
        featureRefId: 'global',
        apiConfigId: 'keep-me',
        updatedAt: 't',
      },
      {
        id: 'f2',
        featureType: 'rerank',
        featureRefId: 'global',
        apiConfigId: 'other',
        updatedAt: 't',
      },
    ])
    assert.equal(refs.length, 1)
    assert.equal(refs[0]?.kind, 'global_feature_binding')
    assert.equal(refs[0]?.path, 'chat')
  })
})

describe('findPresetReferencesInSettings', () => {
  it('finds conversation apiPreset references', () => {
    const presets: ApiPreset[] = [
      {
        id: 'keep-me',
        alias: 'A',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4',
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
      },
    ]
    const refs = findPresetReferencesInSettings(
      'keep-me',
      { activePresetId: 'other', presets, featureBindings: [] },
      [
        {
          conversationId: 'a1b2c3d4',
          title: '测试对话',
          relPath: 'index.json',
          apiPreset: {
            chat: { apiConfigId: 'keep-me' },
            plugins: { foo: { apiConfigId: 'other' } },
          },
        },
      ],
    )
    assert.equal(refs.length, 1)
    assert.equal(refs[0]?.kind, 'conversation_api_preset')
    assert.equal(refs[0]?.conversationId, 'a1b2c3d4')
    assert.equal(refs[0]?.path, 'chat')
  })
})

describe('findKeyReferencesInSettings', () => {
  it('finds preset and embedding references', () => {
    const presets: ApiPreset[] = [
      {
        id: 'p1',
        alias: 'Main',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        apiKeyId: 'key-1',
        model: 'gpt-4',
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
      },
    ]
    const refs = findKeyReferencesInSettings('key-1', { presets }, 'key-1')
    assert.equal(refs.length, 2)
    assert.ok(refs.some((r) => r.kind === 'api_preset_api_key'))
    assert.ok(refs.some((r) => r.kind === 'embedding_api_key'))
  })
})
