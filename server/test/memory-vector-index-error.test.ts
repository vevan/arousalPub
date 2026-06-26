import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isMemoryVectorIndexCorruptError } from '../src/memory-vector-index-error.js'

describe('isMemoryVectorIndexCorruptError', () => {
  it('detects lance not-found on turn_memory paths', () => {
    const msg =
      'Failed to get next batch from stream: lance error: Not found: D:/data/turn_memory.lance/data/foo.lance'
    assert.equal(isMemoryVectorIndexCorruptError(new Error(msg)), true)
  })

  it('ignores unrelated errors', () => {
    assert.equal(isMemoryVectorIndexCorruptError(new Error('conversation_not_found')), false)
    assert.equal(isMemoryVectorIndexCorruptError(new Error('Not found: user.json')), false)
  })

  it('detects mixed lance manifest naming scheme errors', () => {
    const msg =
      'lance error: Found multiple manifest naming schemes in the same directory: V2 and V1.'
    assert.equal(isMemoryVectorIndexCorruptError(new Error(msg)), true)
  })
})
