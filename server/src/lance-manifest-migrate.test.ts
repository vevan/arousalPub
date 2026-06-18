import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  detectLanceManifestScheme,
  isLanceManifestSchemeError,
  lanceV2ManifestFilename,
  migrateManifestPathsV2OnDisk,
} from './lance-manifest-migrate.js'

describe('isLanceManifestSchemeError', () => {
  it('detects mixed manifest naming scheme errors', () => {
    const msg =
      'lance error: Found multiple manifest naming schemes in the same directory: V2 and V1. Use `migrate_manifest_paths_v2` to migrate the directory.'
    assert.equal(isLanceManifestSchemeError(new Error(msg)), true)
  })

  it('ignores unrelated errors', () => {
    assert.equal(isLanceManifestSchemeError(new Error('conversation_not_found')), false)
  })
})

describe('detectLanceManifestScheme', () => {
  it('classifies V1 and V2 manifest filenames', () => {
    assert.equal(detectLanceManifestScheme('3.manifest'), 'v1')
    assert.equal(
      detectLanceManifestScheme(lanceV2ManifestFilename(3)),
      'v2',
    )
  })
})

describe('migrateManifestPathsV2OnDisk', () => {
  it('renames V1 manifest files to V2 layout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lance-migrate-'))
    const versionsDir = path.join(root, 'turn_memory.lance', '_versions')
    await mkdir(versionsDir, { recursive: true })
    await writeFile(path.join(versionsDir, '2.manifest'), 'stub')

    const migrated = await migrateManifestPathsV2OnDisk(
      path.join(root, 'turn_memory.lance'),
    )
    assert.equal(migrated, true)
    const files = await readdir(versionsDir)
    assert.equal(files.includes('2.manifest'), false)
    assert.equal(files.includes(lanceV2ManifestFilename(2)), true)
  })
})
