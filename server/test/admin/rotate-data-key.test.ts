import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveDataEncryptionKeyForTest } from '../../src/data-encryption-key.js'
import {
  encryptSecret,
  decryptSecret,
} from '../../src/secret-encryption.js'
import {
  rotateApiKeysDocument,
  rotateApiSettingsDocument,
  rotateUserPreferencesDocument,
} from '../../src/admin/rotate-data-key.js'

const OLD_KEY = resolveDataEncryptionKeyForTest('old-dek-material-for-rotate-test')
const NEW_KEY = resolveDataEncryptionKeyForTest('new-dek-material-for-rotate-test')

describe('rotate-data-key documents', () => {
  it('reencrypts api-keys.json fields', () => {
    const userId = 'a1b2c3d4'
    const keyId = 'key00001'
    const aad = `arousal:${userId}:api-key:${keyId}`
    const keyEnc = encryptSecret('sk-secret', { key: OLD_KEY, aad })
    const doc = {
      version: 1 as const,
      savedAt: '2026-01-01T00:00:00.000Z',
      keys: [
        {
          id: keyId,
          alias: 'main',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          keyEnc,
        },
      ],
    }
    const rotated = rotateApiKeysDocument(doc, userId, OLD_KEY, NEW_KEY)
    assert.equal(rotated.count, 1)
    assert.equal(rotated.doc.keys[0].key, undefined)
    const blob = rotated.doc.keys[0].keyEnc
    assert.ok(blob)
    const plain = decryptSecret(blob, { key: NEW_KEY, aad })
    assert.equal(plain, 'sk-secret')
  })

  it('reencrypts legacy plaintext in api-settings', () => {
    const userId = 'a1b2c3d4'
    const presetId = 'preset01'
    const aad = `arousal:${userId}:preset:${presetId}`
    const doc = {
      version: 1 as const,
      savedAt: '2026-01-01T00:00:00.000Z',
      activePresetId: presetId,
      presets: [
        {
          id: presetId,
          alias: 'p',
          apiKey: 'inline-key',
        },
      ],
    }
    const rotated = rotateApiSettingsDocument(doc, userId, OLD_KEY, NEW_KEY)
    assert.equal(rotated.count, 1)
    const blob = rotated.doc.presets[0].apiKeyEnc
    assert.ok(blob)
    assert.equal(
      decryptSecret(blob, { key: NEW_KEY, aad }),
      'inline-key',
    )
    assert.equal(rotated.doc.presets[0].apiKey, undefined)
  })

  it('reencrypts embedding key in user-preferences', () => {
    const userId = 'a1b2c3d4'
    const aad = `arousal:${userId}:embedding`
    const doc = {
      version: 1 as const,
      savedAt: '2026-01-01T00:00:00.000Z',
      embeddingApi: {
        apiKey: 'emb-key',
        baseUrl: 'http://localhost',
      },
    }
    const rotated = rotateUserPreferencesDocument(doc, userId, OLD_KEY, NEW_KEY)
    assert.equal(rotated.count, 1)
    const blob = rotated.doc.embeddingApi?.apiKeyEnc
    assert.ok(blob)
    assert.equal(decryptSecret(blob, { key: NEW_KEY, aad }), 'emb-key')
    assert.equal(rotated.doc.embeddingApi?.apiKey, undefined)
  })
})
