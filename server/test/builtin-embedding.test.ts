import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  BUILTIN_EMBEDDING_BATCH_MAX_INPUTS,
  BUILTIN_EMBEDDING_MAX_CHARS_PER_TEXT,
  BUILTIN_EMBEDDING_MAX_TOTAL_CHARS,
  BuiltinEmbeddingInputError,
  BuiltinEmbeddingPrepareRateLimitedError,
  assertBuiltinEmbeddingTextsWithinLimits,
  createBuiltinEmbeddings,
  getBuiltinEmbeddingStatus,
  mapBuiltinEmbeddingError,
  prepareBuiltinEmbedding,
  sanitizeBuiltinEmbeddingErrorMessage,
  setBuiltinEmbeddingLoaderForTests,
  tryAcquireBuiltinPrepareSlot,
} from '../src/builtin-embedding.js'

afterEach(() => {
  setBuiltinEmbeddingLoaderForTests(null)
})

describe('builtin embedding limits', () => {
  it('rejects oversized single text and batch totals', () => {
    assert.throws(
      () =>
        assertBuiltinEmbeddingTextsWithinLimits([
          'x'.repeat(BUILTIN_EMBEDDING_MAX_CHARS_PER_TEXT + 1),
        ]),
      BuiltinEmbeddingInputError,
    )
    const many = Array.from({ length: BUILTIN_EMBEDDING_BATCH_MAX_INPUTS + 1 }, () => 'a')
    assert.throws(
      () => assertBuiltinEmbeddingTextsWithinLimits(many),
      BuiltinEmbeddingInputError,
    )
    const mid = Math.floor(BUILTIN_EMBEDDING_MAX_TOTAL_CHARS / 4) + 1
    assert.throws(
      () =>
        assertBuiltinEmbeddingTextsWithinLimits([
          'y'.repeat(mid),
          'y'.repeat(mid),
          'y'.repeat(mid),
          'y'.repeat(mid),
        ]),
      BuiltinEmbeddingInputError,
    )
  })

  it('createBuiltinEmbeddings enforces limits before loading the model', async () => {
    let loaded = 0
    setBuiltinEmbeddingLoaderForTests(async () => {
      loaded++
      return async () => ({ tolist: () => [[]] })
    })
    await assert.rejects(
      () =>
        createBuiltinEmbeddings([
          'z'.repeat(BUILTIN_EMBEDDING_MAX_CHARS_PER_TEXT + 1),
        ]),
      BuiltinEmbeddingInputError,
    )
    assert.equal(loaded, 0)
  })

  it('redacts absolute paths from status errors', async () => {
    setBuiltinEmbeddingLoaderForTests(async () => {
      throw new Error('failed at C:\\Users\\me\\ArousalPub\\models\\x and /home/me/cache/y')
    })
    await assert.rejects(() => prepareBuiltinEmbedding())
    const status = getBuiltinEmbeddingStatus()
    assert.equal(status.state, 'error')
    assert.ok(status.error)
    assert.equal(status.error.includes('C:\\Users'), false)
    assert.equal(status.error.includes('/home/me'), false)
    assert.ok(status.error.includes('[path]'))
    assert.equal('cacheDir' in status, false)
  })

  it('rate-limits prepare after a failed attempt', async () => {
    setBuiltinEmbeddingLoaderForTests(async () => {
      throw new Error('boom')
    })
    await assert.rejects(() => prepareBuiltinEmbedding())
    assert.equal(tryAcquireBuiltinPrepareSlot(), false)
    await assert.rejects(
      () => prepareBuiltinEmbedding(),
      BuiltinEmbeddingPrepareRateLimitedError,
    )
  })

  it('mapBuiltinEmbeddingError redacts paths and maps error codes', () => {
    const oversized = mapBuiltinEmbeddingError(
      new BuiltinEmbeddingInputError('failed at C:\\Users\\me\\models'),
    )
    assert.equal(oversized.error, 'builtin_embedding_input_too_large')
    assert.equal(oversized.status, 400)
    assert.equal(oversized.detail?.includes('C:\\Users'), false)

    const limited = mapBuiltinEmbeddingError(
      new BuiltinEmbeddingPrepareRateLimitedError(),
    )
    assert.equal(limited.error, 'embedding_prepare_rate_limited')
    assert.equal(limited.status, 429)

    const generic = mapBuiltinEmbeddingError(
      new Error('boom /home/user/cache/x'),
    )
    assert.equal(generic.error, '内置 Embedding 推理失败')
    assert.equal(generic.detail?.includes('/home/user'), false)

    assert.equal(
      sanitizeBuiltinEmbeddingErrorMessage('x /data/arousal/models/a y'),
      'x [path] y',
    )
    assert.equal(
      sanitizeBuiltinEmbeddingErrorMessage('x \\\\server\\share\\models y'),
      'x [path] y',
    )
  })
})
