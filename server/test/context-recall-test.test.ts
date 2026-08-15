import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isConversationMemoryIndexReadyForRecall,
  parseContextRecallTestBody,
} from '../src/context-recall-test.js'

describe('parseContextRecallTestBody', () => {
  it('requires non-empty query', () => {
    assert.deepEqual(parseContextRecallTestBody({ query: '  ', topK: 5 }), {
      ok: false,
      error: 'context_recall_query_required',
    })
  })

  it('accepts query and topK', () => {
    assert.deepEqual(parseContextRecallTestBody({ query: 'hello', topK: 8 }), {
      ok: true,
      request: { query: 'hello', topK: 8 },
    })
  })

  it('defaults topK to 10', () => {
    const parsed = parseContextRecallTestBody({ query: 'x' })
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.request.topK, 10)
  })

  it('rejects topK out of range', () => {
    assert.deepEqual(parseContextRecallTestBody({ query: 'x', topK: 0 }), {
      ok: false,
      error: 'context_recall_topk_invalid',
    })
    assert.deepEqual(parseContextRecallTestBody({ query: 'x', topK: 100 }), {
      ok: false,
      error: 'context_recall_topk_invalid',
    })
  })

  it('accepts optional simulateTurnOrdinal', () => {
    assert.deepEqual(
      parseContextRecallTestBody({ query: 'x', simulateTurnOrdinal: 12 }),
      { ok: true, request: { query: 'x', topK: 10, simulateTurnOrdinal: 12 } },
    )
    assert.deepEqual(
      parseContextRecallTestBody({ query: 'x', alignTurnOrdinal: 12 }),
      { ok: true, request: { query: 'x', topK: 10, simulateTurnOrdinal: 12 } },
    )
    assert.deepEqual(
      parseContextRecallTestBody({ query: 'x', simulateTurnOrdinal: -1 }),
      { ok: false, error: 'context_recall_simulate_turn_invalid' },
    )
  })
})

describe('isConversationMemoryIndexReadyForRecall', () => {
  const provider = {
    provider: 'openai_compatible' as const,
    baseUrl: 'https://example.com/v1',
    apiKey: 'x',
    embeddingProfile: 'openai:text-embedding-3-small',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
  }
  const indexOk = {
    memoryEmbeddingProfile: provider.embeddingProfile,
    memoryEmbeddingModel: provider.embeddingModel,
    memoryEmbeddingDimensions: provider.embeddingDimensions,
    memoryHybridFtsProfile: 'zh-jieba:default',
  }
  const effective = {
    profile: 'zh-jieba' as const,
    dictVariant: 'default' as const,
  }

  it('returns true when embedding and hybrid FTS stamps match', () => {
    assert.equal(
      isConversationMemoryIndexReadyForRecall(indexOk, provider, effective),
      true,
    )
  })

  it('returns false when hybrid FTS stamp mismatches', () => {
    assert.equal(
      isConversationMemoryIndexReadyForRecall(
        { ...indexOk, memoryHybridFtsProfile: 'lindera:ipadic' },
        provider,
        effective,
      ),
      false,
    )
  })

  it('returns false when embedding stamp mismatches', () => {
    assert.equal(
      isConversationMemoryIndexReadyForRecall(
        { ...indexOk, memoryEmbeddingProfile: 'other-profile' },
        provider,
        effective,
      ),
      false,
    )
  })
})
