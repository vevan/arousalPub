import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMBEDDING_BATCH_MAX_INPUTS,
  embedTextsInBatches,
} from '../src/embedding-batch.js'
import {
  BUILTIN_EMBEDDING_DIMENSIONS,
  setBuiltinEmbeddingLoaderForTests,
} from '../src/builtin-embedding.js'

const API_CREDS = {
  provider: 'openai_compatible' as const,
  baseUrl: 'https://example.com/v1',
  apiKey: '',
  embeddingModel: 'test-embedding',
  embeddingDimensions: null,
  embeddingProfile: 'api:test-embedding:default:v1',
}

describe('embedding batch constants', () => {
  it('batch size is positive', () => {
    assert.ok(EMBEDDING_BATCH_MAX_INPUTS >= 8)
  })

  it('rejects vectors with inconsistent dimensions across batches', async () => {
    const prevFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      const embedding = calls++ === 0 ? [1, 2] : [1, 2, 3]
      return new Response(
        JSON.stringify({
          model: 'test-embedding',
          data: [{ index: 0, embedding }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    try {
      const result = await embedTextsInBatches(
        API_CREDS,
        [
          { key: 'a', text: 'one' },
          { key: 'b', text: 'two' },
        ],
        { batchSize: 1, concurrency: 1 },
      )
      assert.equal('ok' in result && result.ok, false)
      assert.match(result.error, /维度不一致/)
    } finally {
      globalThis.fetch = prevFetch
    }
  })

  it('reports progress as embedding batches complete', async () => {
    const prevFetch = globalThis.fetch
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        input?: string[]
      }
      const count = Array.isArray(body.input) ? body.input.length : 1
      return new Response(
        JSON.stringify({
          model: 'test-embedding',
          data: Array.from({ length: count }, (_, index) => ({
            index,
            embedding: [1, 2],
          })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    try {
      const events: { completedItems: number; totalItems: number }[] = []
      const result = await embedTextsInBatches(
        API_CREDS,
        [
          { key: 'a', text: 'one' },
          { key: 'b', text: 'two' },
          { key: 'c', text: 'three' },
        ],
        {
          batchSize: 1,
          concurrency: 1,
          onProgress: (progress) => {
            events.push({
              completedItems: progress.completedItems,
              totalItems: progress.totalItems,
            })
          },
        },
      )
      assert.equal('ok' in result && result.ok, true)
      assert.deepEqual(events, [
        { completedItems: 1, totalItems: 3 },
        { completedItems: 2, totalItems: 3 },
        { completedItems: 3, totalItems: 3 },
      ])
    } finally {
      globalThis.fetch = prevFetch
    }
  })

  it('routes builtin batches through one serialized local extractor', async () => {
    let active = 0
    let maxActive = 0
    let calls = 0
    setBuiltinEmbeddingLoaderForTests(async () => {
      return async (texts) => {
        calls += 1
        active += 1
        maxActive = Math.max(maxActive, active)
        await Promise.resolve()
        const rows = (Array.isArray(texts) ? texts : [texts]).map(() =>
          Array.from({ length: BUILTIN_EMBEDDING_DIMENSIONS }, () => 0.25),
        )
        active -= 1
        return { tolist: () => rows }
      }
    })

    try {
      const result = await embedTextsInBatches(
        {
          provider: 'builtin',
          embeddingModel: 'builtin:test',
          embeddingDimensions: BUILTIN_EMBEDDING_DIMENSIONS,
          embeddingProfile: 'builtin:test:v1',
          modelId: 'test',
          revision: 'test',
          dtype: 'q8',
          device: 'cpu',
        },
        Array.from({ length: 20 }, (_, index) => ({
          key: String(index),
          text: `text ${index}`,
        })),
        { concurrency: 4 },
      )
      assert.equal('ok' in result && result.ok, true)
      assert.equal(calls, 2)
      assert.equal(maxActive, 1)
      if ('ok' in result && result.ok) {
        assert.equal(result.vectors.size, 20)
        assert.equal(result.vectors.get('0')?.length, BUILTIN_EMBEDDING_DIMENSIONS)
      }
    } finally {
      setBuiltinEmbeddingLoaderForTests(null)
    }
  })
})
