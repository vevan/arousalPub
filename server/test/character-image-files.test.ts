import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildBoundFileLookup,
  findDuplicateNamesInMetas,
  normalizeFileNameKey,
  normalizeImageFileIdList,
  pickEarliestMeta,
  resolveBoundFileById,
  resolveBoundFileByName,
  CHARACTER_IMAGE_FILES_MAX,
} from '../src/character-image-files.js'
import { parseCharFileMacroHead } from '../src/prompt-macros/macro-values.js'
import type { FileLibraryMeta } from '../src/file-library-storage.js'

function meta(
  partial: Partial<FileLibraryMeta> & Pick<FileLibraryMeta, 'fileId' | 'name'>,
): FileLibraryMeta {
  return {
    schemaVersion: 1,
    kind: 'image',
    mime: 'image/png',
    size: 1,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    tags: [],
    ...partial,
  }
}

describe('character-image-files helpers', () => {
  it('normalizes file id list', () => {
    assert.deepEqual(
      normalizeImageFileIdList(['A1b2c3d4', 'a1b2c3d4', 'nope', 'e5f6a7b8']),
      ['a1b2c3d4', 'e5f6a7b8'],
    )
  })

  it('detects duplicate names case-insensitively', () => {
    const conflicts = findDuplicateNamesInMetas([
      meta({ fileId: 'a1b2c3d4', name: ' Foo ' }),
      meta({ fileId: 'e5f6a7b8', name: 'foo' }),
      meta({ fileId: '11111111', name: 'bar' }),
    ])
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0]!.nameKey, 'foo')
    assert.deepEqual(conflicts[0]!.fileIds, ['a1b2c3d4', 'e5f6a7b8'])
  })

  it('pickEarliestMeta uses createdAt then fileId', () => {
    const pick = pickEarliestMeta([
      meta({
        fileId: 'bbbbbbbb',
        name: 'x',
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
      meta({
        fileId: 'aaaaaaaa',
        name: 'x',
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
      meta({
        fileId: 'cccccccc',
        name: 'x',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ])
    assert.equal(pick?.fileId, 'cccccccc')
  })

  it('FileName resolves earliest on conflict; FileID requires binding', () => {
    const ids = ['bbbbbbbb', 'aaaaaaaa']
    const metas = [
      meta({
        fileId: 'bbbbbbbb',
        name: 'Dup',
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
      meta({
        fileId: 'aaaaaaaa',
        name: 'dup',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ]
    const lookup = buildBoundFileLookup(ids, metas, '00000001')
    assert.equal(lookup.nameConflict, true)
    const byName = resolveBoundFileByName(lookup, 'DUP')
    assert.equal(byName, resolveBoundFileById(lookup, 'aaaaaaaa'))
    assert.equal(resolveBoundFileById(lookup, 'cccccccc'), '')
    assert.ok(resolveBoundFileById(lookup, 'aaaaaaaa').startsWith('/api/m/'))
  })

  it('max constant is 30', () => {
    assert.equal(CHARACTER_IMAGE_FILES_MAX, 30)
    assert.equal(normalizeFileNameKey('  X '), 'x')
  })
})

describe('parseCharFileMacroHead', () => {
  it('parses char/user FileID and FileName heads', () => {
    assert.deepEqual(parseCharFileMacroHead('charFileID'), {
      kind: 'id',
      target: 1,
    })
    assert.deepEqual(parseCharFileMacroHead('char2filename'), {
      kind: 'name',
      target: 2,
    })
    assert.deepEqual(parseCharFileMacroHead('userFileName'), {
      kind: 'name',
      target: 'user',
    })
    assert.equal(parseCharFileMacroHead('char2'), null)
  })
})

describe('invokeCstMacro char file', () => {
  it('expands FileID and FileName from lookups', async () => {
    const { invokeCstMacro } = await import(
      '../src/prompt-macros/cst/macro-registry.js'
    )
    const { parseMacroTagInner } = await import(
      '../src/prompt-macros/macro-tag-parse.js'
    )
    const { buildPromptMacroContext } = await import(
      '../src/prompt-macros/context.js'
    )
    const lookup = buildBoundFileLookup(
      ['a1b2c3d4'],
      [
        meta({
          fileId: 'a1b2c3d4',
          name: 'Hero',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ],
      '00000001',
    )
    const ctx = buildPromptMacroContext({
      characters: [{ name: 'A' }],
      charFileLookups: [lookup],
    })
    const idTag = parseMacroTagInner('charFileID::a1b2c3d4')
    const nameTag = parseMacroTagInner('char1FileName::hero')
    const miss = parseMacroTagInner('charFileID::ffffffff')
    assert.ok(invokeCstMacro(idTag, ctx, (s) => s).startsWith('/api/m/'))
    assert.equal(
      invokeCstMacro(nameTag, ctx, (s) => s),
      invokeCstMacro(idTag, ctx, (s) => s),
    )
    assert.equal(invokeCstMacro(miss, ctx, (s) => s), '')
  })
})
