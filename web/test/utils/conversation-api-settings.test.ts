import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ApiPreset } from '@/stores/connection'
import {
  fieldToOptionalNumber,
  mergePresetWithChatBinding,
  optionalNumToField,
  resolveEmbeddingFormDraft,
  buildEmbeddingOverridePatch,
} from '@/utils/conversation-api-settings'

const basePreset = {
  id: 'preset-a',
  alias: 'A',
  model: 'model-a',
  stream: true,
  showReasoningChain: false,
  requestReasoningChain: false,
  contextLength: 1000,
  maxTokens: 100,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  dryMultiplier: null,
  dryBase: null,
  dryAllowedLength: null,
  dryPenaltyLastN: null,
  drySequenceBreakers: ['\n'],
  frequencyPenalty: null,
  presencePenalty: null,
  customParamsJson: '',
  keyConfigured: true,
  apiKeyId: null,
} as ApiPreset

describe('fieldToOptionalNumber', () => {
  it('maps empty form values to null', () => {
    assert.equal(fieldToOptionalNumber(''), null)
    assert.equal(fieldToOptionalNumber(null), null)
    assert.equal(fieldToOptionalNumber(undefined), null)
  })

  it('parses finite numbers and rejects NaN', () => {
    assert.equal(fieldToOptionalNumber(0.5), 0.5)
    assert.equal(fieldToOptionalNumber('1.25'), 1.25)
    assert.equal(fieldToOptionalNumber('nope'), null)
  })
})

describe('mergePresetWithChatBinding null retention', () => {
  it('keeps explicit null instead of falling back to preset', () => {
    const merged = mergePresetWithChatBinding(basePreset, {
      temperature: null,
      topP: null,
      contextLength: null,
    })
    assert.equal(merged.temperature, null)
    assert.equal(merged.topP, null)
    assert.equal(merged.contextLength, null)
    assert.equal(optionalNumToField(merged.temperature), '')
  })

  it('still inherits undefined keys from preset', () => {
    const merged = mergePresetWithChatBinding(basePreset, { model: 'x' })
    assert.equal(merged.temperature, 0.7)
    assert.equal(merged.model, 'x')
  })
})

describe('resolveEmbeddingFormDraft', () => {
  it('uses global when override is absent', () => {
    const draft = resolveEmbeddingFormDraft('g-model', 768, undefined)
    assert.equal(draft.model, 'g-model')
    assert.equal(draft.dimensions, 768)
  })

  it('preserves explicit null dimensions instead of ?? global', () => {
    const draft = resolveEmbeddingFormDraft('g-model', 768, {
      embeddingModel: 'local',
      embeddingDimensions: null,
    })
    assert.equal(draft.model, 'local')
    assert.equal(draft.dimensions, '')
  })

  it('preserves empty embeddingModel override', () => {
    const draft = resolveEmbeddingFormDraft('g-model', 768, {
      embeddingModel: '',
    })
    assert.equal(draft.model, '')
    assert.equal(draft.dimensions, 768)
  })
})

describe('buildEmbeddingOverridePatch', () => {
  it('returns undefined when form matches global and no existing override', () => {
    assert.equal(
      buildEmbeddingOverridePatch('g-model', 768, 'g-model', 768, undefined),
      undefined,
    )
  })

  it('returns null to clear when form matches global but override exists', () => {
    assert.equal(
      buildEmbeddingOverridePatch('g-model', 768, 'g-model', 768, {
        embeddingDimensions: 512,
      }),
      null,
    )
  })

  it('keeps explicit null dimensions in patch', () => {
    const patch = buildEmbeddingOverridePatch('g-model', 768, 'local', '', {
      embeddingModel: 'old',
    })
    assert.deepEqual(patch, {
      embeddingModel: 'local',
      embeddingDimensions: null,
    })
  })
})
