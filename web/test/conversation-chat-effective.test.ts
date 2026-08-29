import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isPresetApiKeyConfigured,
  resolveEffectiveConversationChatDisplay,
} from '@/utils/conversation-chat-effective'

describe('conversation-chat-effective', () => {
  it('uses the conversation override preset and model when not inheriting', () => {
    const conn = {
      activePresetId: 'preset-a',
      presets: [
        {
          id: 'preset-a',
          alias: 'A',
          model: 'model-a',
          stream: true,
          showReasoningChain: false,
          requestReasoningChain: false,
          contextLength: 1000,
          maxTokens: 100,
          temperature: 0.5,
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
          keyConfigured: true,
          apiKeyId: null,
        },
        {
          id: 'preset-b',
          alias: 'B',
          model: 'model-b',
          stream: false,
          showReasoningChain: true,
          requestReasoningChain: false,
          contextLength: 2000,
          maxTokens: 200,
          temperature: 0.2,
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
          keyConfigured: true,
          apiKeyId: null,
        },
      ],
    }
    const conversationApi = {
      bindingFor: () => ({
        apiConfigId: 'preset-b',
        model: 'override-model',
        stream: false,
      }),
    }
    const effective = resolveEffectiveConversationChatDisplay(
      conn as never,
      conversationApi as never,
      'c1234567',
    )
    assert.equal(effective?.apiPresetId, 'preset-b')
    assert.equal(effective?.model, 'override-model')
    assert.equal(effective?.stream, false)
  })

  it('ignores inheritGlobal snapshot and uses the active preset', () => {
    const conn = {
      activePresetId: 'preset-a',
      presets: [
        {
          id: 'preset-a',
          alias: 'A',
          model: 'model-a',
          stream: true,
          showReasoningChain: false,
          requestReasoningChain: false,
          contextLength: 1000,
          maxTokens: 100,
          temperature: 0.5,
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
          keyConfigured: true,
          apiKeyId: null,
        },
      ],
    }
    const conversationApi = {
      bindingFor: () => ({
        inheritGlobal: true,
        apiConfigId: 'preset-a',
        model: 'saved-for-later',
      }),
    }
    const effective = resolveEffectiveConversationChatDisplay(
      conn as never,
      conversationApi as never,
      'c1234567',
    )
    assert.equal(effective?.model, 'model-a')
    assert.equal(effective?.stream, true)
  })

  it('detects keyConfigured on the bound preset', () => {
    const conn = {
      presets: [
        { id: 'preset-a', keyConfigured: false, apiKeyId: null },
        { id: 'preset-b', keyConfigured: true, apiKeyId: null },
      ],
    }
    const apiKeys = { findById: () => null }
    assert.equal(
      isPresetApiKeyConfigured(conn as never, apiKeys as never, 'preset-b'),
      true,
    )
    assert.equal(
      isPresetApiKeyConfigured(conn as never, apiKeys as never, 'preset-a'),
      false,
    )
  })
})
