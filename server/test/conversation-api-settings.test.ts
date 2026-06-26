import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mergePresetWithChatBinding,
  parseConversationChatBinding,
  parseConversationEmbeddingApiOverride,
  resolveConversationEmbeddingModelSettings,
} from '../src/conversation-api-settings.js'
import { EMBEDDING_API_SETTINGS_DEFAULTS } from '../src/embedding-api-settings.js'

describe('conversation-api-settings', () => {
  it('rejects forbidden connection fields on chat binding', () => {
    const r = parseConversationChatBinding({ baseUrl: 'http://x' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.error, 'conversation_api_preset_forbidden_field')
  })

  it('parses chat binding with preset and params', () => {
    const r = parseConversationChatBinding({
      apiConfigId: 'abc12345',
      model: 'gpt-4o-mini',
      temperature: 0.8,
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.binding?.apiConfigId, 'abc12345')
      assert.equal(r.binding?.model, 'gpt-4o-mini')
      assert.equal(r.binding?.temperature, 0.8)
    }
  })

  it('merges preset with binding overrides', () => {
    const preset = {
      id: 'p1',
      alias: 'Main',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o',
      contextLength: 8192,
      maxTokens: 512,
      stream: true,
      temperature: 1,
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
      apiKeyId: null,
    }
    const merged = mergePresetWithChatBinding(preset, {
      model: 'gpt-4o-mini',
      temperature: 0.5,
    })
    assert.equal(merged.model, 'gpt-4o-mini')
    assert.equal(merged.temperature, 0.5)
    assert.equal(merged.maxTokens, 512)
  })

  it('resolves embedding model override only', () => {
    const g = EMBEDDING_API_SETTINGS_DEFAULTS
    const eff = resolveConversationEmbeddingModelSettings(g, {
      embeddingModel: 'custom-embed',
    })
    assert.equal(eff.embeddingModel, 'custom-embed')
    assert.equal(eff.embeddingDimensions, g.embeddingDimensions)
  })

  it('rejects embedding forbidden fields', () => {
    const r = parseConversationEmbeddingApiOverride({ baseUrl: 'x' })
    assert.equal(r.ok, false)
  })

  it('accepts empty embedding override marker', () => {
    const r = parseConversationEmbeddingApiOverride({})
    assert.equal(r.ok, true)
    if (r.ok) assert.deepEqual(r.patch, {})
  })
})
