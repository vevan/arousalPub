import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  embeddingIndexMatchesIdentity,
  resolveEmbeddingIdentity,
} from '../../src/utils/embedding-api-settings.js'

describe('embedding API identity', () => {
  it('changes profile when the API endpoint changes', () => {
    const first = resolveEmbeddingIdentity({
      provider: 'openai_compatible',
      baseUrl: 'https://one.example/v1',
      embeddingModel: 'same-model',
      embeddingDimensions: 384,
    })
    const second = resolveEmbeddingIdentity({
      provider: 'openai_compatible',
      baseUrl: 'https://two.example/v1',
      embeddingModel: 'same-model',
      embeddingDimensions: 384,
    })
    assert.notEqual(first.embeddingProfile, second.embeddingProfile)
  })

  it('does not accept legacy metadata without an endpoint-aware profile', () => {
    const active = resolveEmbeddingIdentity({
      provider: 'openai_compatible',
      baseUrl: 'https://one.example/v1',
      embeddingModel: 'same-model',
      embeddingDimensions: 384,
    })
    assert.equal(
      embeddingIndexMatchesIdentity({
        embeddingModel: 'same-model',
        embeddingDimensions: 384,
      }, active),
      false,
    )
  })
})
