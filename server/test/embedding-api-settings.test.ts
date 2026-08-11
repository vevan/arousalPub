import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMBEDDING_API_SETTINGS_DEFAULTS,
  normalizeEmbeddingApiSettings,
} from '../src/embedding-api-settings.js'
import {
  BUILTIN_EMBEDDING_DIMENSIONS,
  BUILTIN_EMBEDDING_PROFILE,
} from '../src/builtin-embedding.js'
import {
  embeddingApiProfile,
  resolveEmbeddingApiCredentialsFrom,
} from '../src/embedding-credential-resolve.js'
import { embeddingIndexMatchesProvider } from '../src/embedding-profile.js'

describe('embedding provider settings', () => {
  it('migrates settings without provider to openai compatible', () => {
    const settings = normalizeEmbeddingApiSettings({
      baseUrl: 'http://localhost:11434/v1',
      embeddingModel: 'nomic-embed-text',
    })
    assert.equal(settings.provider, 'openai_compatible')
  })

  it('normalizes unknown providers to openai compatible', () => {
    const settings = normalizeEmbeddingApiSettings({
      provider: 'invalid' as never,
    })
    assert.equal(settings.provider, EMBEDDING_API_SETTINGS_DEFAULTS.provider)
  })

  it('builds profiles without connection or secret data', () => {
    assert.equal(
      embeddingApiProfile('text-embedding-3-small', 1536),
      'api:text-embedding-3-small:1536:v1',
    )
  })

  it('resolves builtin to its fixed model contract', async () => {
    const resolved = await resolveEmbeddingApiCredentialsFrom({
      provider: 'builtin',
      baseUrl: 'https://should-not-be-used.example/v1',
      apiKey: 'should-not-be-used',
      embeddingModel: 'should-not-be-used',
      embeddingDimensions: 123,
    })
    assert.equal(resolved.provider, 'builtin')
    assert.equal(resolved.embeddingDimensions, BUILTIN_EMBEDDING_DIMENSIONS)
    assert.equal(resolved.embeddingProfile, BUILTIN_EMBEDDING_PROFILE)
    assert.equal('baseUrl' in resolved, false)
    assert.equal('apiKey' in resolved, false)
  })

  it('never migrates a legacy API index into the builtin vector space', async () => {
    const builtin = await resolveEmbeddingApiCredentialsFrom({ provider: 'builtin' })
    assert.equal(
      embeddingIndexMatchesProvider({
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 384,
      }, builtin),
      false,
    )
  })

  it('migrates legacy model and dimensions only for the matching API profile', async () => {
    const api = await resolveEmbeddingApiCredentialsFrom({
      provider: 'openai_compatible',
      embeddingModel: 'legacy-model',
      embeddingDimensions: 768,
    })
    assert.equal(
      embeddingIndexMatchesProvider({
        embeddingModel: 'legacy-model',
        embeddingDimensions: 768,
      }, api),
      true,
    )
  })
})
