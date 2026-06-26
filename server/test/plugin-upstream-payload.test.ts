import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPluginCompleteUpstreamPayload } from '../src/plugin-upstream-payload.js'
import type { ApiPreset } from '../src/api-settings-file.js'

function minimalPreset(overrides: Partial<ApiPreset> = {}): ApiPreset {
  return {
    id: 'p1',
    alias: 'p1',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'k',
    model: 'm',
    contextLength: null,
    maxTokens: 512,
    stream: false,
    temperature: 0.2,
    topP: null,
    topK: null,
    dryMultiplier: 1.5,
    dryBase: null,
    dryAllowedLength: null,
    dryPenaltyLastN: null,
    drySequenceBreakers: [],
    frequencyPenalty: null,
    presencePenalty: null,
    customParamsJson: '',
    showReasoningChain: false,
    requestReasoningChain: false,
    ...overrides,
  }
}

describe('buildPluginCompleteUpstreamPayload', () => {
  it('includes dry sampler and disables thinking', () => {
    const payload = buildPluginCompleteUpstreamPayload({
      preset: minimalPreset(),
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    })
    assert.equal(payload.dry_multiplier, 1.5)
    assert.deepEqual(payload.thinking, { type: 'disabled' })
  })

  it('applies response_format after customParams', () => {
    const payload = buildPluginCompleteUpstreamPayload({
      preset: minimalPreset({
        customParamsJson: JSON.stringify({
          response_format: { type: 'text' },
          thinking: { type: 'enabled' },
        }),
      }),
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: 'json_object',
    })
    assert.deepEqual(payload.response_format, { type: 'json_object' })
    assert.deepEqual(payload.thinking, { type: 'disabled' })
  })
})
