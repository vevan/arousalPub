import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EMBEDDING_BATCH_MAX_INPUTS } from './embedding-batch.js'

describe('embedding batch constants', () => {
  it('batch size is positive', () => {
    assert.ok(EMBEDDING_BATCH_MAX_INPUTS >= 8)
  })
})
