import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveDataEncryptionKeyForTest } from '../src/data-encryption-key.js'
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecretV1,
  resolveSecretFromDisk,
  secretToDiskFields,
} from '../src/secret-encryption.js'

const TEST_KEY = resolveDataEncryptionKeyForTest('test-data-encryption-key-material')

describe('secret-encryption', () => {
  it('round-trips with AAD', () => {
    const enc = encryptSecret('sk-test-123', {
      key: TEST_KEY,
      aad: 'user-1:api-key:k1',
    })
    assert.equal(isEncryptedSecretV1(enc), true)
    const plain = decryptSecret(enc, {
      key: TEST_KEY,
      aad: 'user-1:api-key:k1',
    })
    assert.equal(plain, 'sk-test-123')
  })

  it('rejects wrong AAD', () => {
    const enc = encryptSecret('secret', {
      key: TEST_KEY,
      aad: 'user-a',
    })
    assert.throws(() =>
      decryptSecret(enc, { key: TEST_KEY, aad: 'user-b' }),
    )
  })

  it('resolveSecretFromDisk prefers encrypted over legacy', () => {
    const { keyEnc } = secretToDiskFields('enc-key', {
      key: TEST_KEY,
      aad: 'ctx',
    })
    assert.equal(
      resolveSecretFromDisk('legacy-key', keyEnc, { key: TEST_KEY, aad: 'ctx' }),
      'enc-key',
    )
    assert.equal(
      resolveSecretFromDisk('legacy-only', undefined, { key: TEST_KEY }),
      'legacy-only',
    )
  })

  it('secretToDiskFields omits empty', () => {
    assert.deepEqual(secretToDiskFields('', { key: TEST_KEY }), {})
    assert.deepEqual(secretToDiskFields('   ', { key: TEST_KEY }), {})
  })
})
