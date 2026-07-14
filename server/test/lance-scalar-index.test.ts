import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import * as lancedb from '@lancedb/lancedb'
import { makeArrowTable } from '@lancedb/lancedb'
import {
  Field,
  FixedSizeList,
  Float32,
  Int32,
  Schema,
  Utf8,
} from 'apache-arrow'
import {
  ensureScalarIndexes,
  listHasScalarIndex,
  LORE_SCALAR_INDEX_SPECS,
  MEMORY_SCALAR_INDEX_SPECS,
  tableHasScalarIndex,
} from '../src/lance-scalar-index.js'

describe('listHasScalarIndex', () => {
  it('matches Lance BTree/Bitmap casing', () => {
    assert.equal(
      listHasScalarIndex(
        [{ name: 'turnId_idx', indexType: 'BTree', columns: ['turnId'] }],
        'turnId',
        'btree',
      ),
      true,
    )
    assert.equal(
      listHasScalarIndex(
        [{ name: 'x', indexType: 'Bitmap', columns: ['branchPath'] }],
        'branchPath',
        'bitmap',
      ),
      true,
    )
    assert.equal(
      listHasScalarIndex(
        [{ name: 'x', indexType: 'BTree', columns: ['branchPath'] }],
        'branchPath',
        'bitmap',
      ),
      false,
    )
  })
})

describe('ensureScalarIndexes', () => {
  it('creates BTREE/BITMAP on memory-shaped table and is idempotent', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lance-scalar-mem-'))
    try {
      const db = await lancedb.connect(dir)
      const dim = 4
      const schema = new Schema([
        new Field('turnId', new Utf8(), false),
        new Field('turnOrdinal', new Int32(), false),
        new Field('branchPath', new Utf8(), false),
        new Field('chunkFileName', new Utf8(), false),
        new Field('corpus', new Utf8(), false),
        new Field(
          'vector',
          new FixedSizeList(dim, new Field('item', new Float32(), false)),
          false,
        ),
      ])
      const table = await db.createTable(
        'turn_memory',
        makeArrowTable(
          [
            {
              turnId: 'a',
              turnOrdinal: 1,
              branchPath: '',
              chunkFileName: 'turn-000000-000099.json',
              corpus: 'hello',
              vector: [1, 0, 0, 0],
            },
            {
              turnId: 'b',
              turnOrdinal: 2,
              branchPath: 'branch1',
              chunkFileName: 'turn-000100-000199.json',
              corpus: 'world',
              vector: [0, 1, 0, 0],
            },
          ],
          { schema },
        ),
      )

      await ensureScalarIndexes(table, MEMORY_SCALAR_INDEX_SPECS)
      assert.equal(await tableHasScalarIndex(table, 'turnId', 'btree'), true)
      assert.equal(await tableHasScalarIndex(table, 'turnOrdinal', 'btree'), true)
      assert.equal(await tableHasScalarIndex(table, 'branchPath', 'bitmap'), true)

      const before = await table.listIndices()
      await ensureScalarIndexes(table, MEMORY_SCALAR_INDEX_SPECS)
      const after = await table.listIndices()
      assert.equal(after.length, before.length)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('creates scalar indexes on lore-shaped table', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lance-scalar-lore-'))
    try {
      const db = await lancedb.connect(dir)
      const dim = 4
      const schema = new Schema([
        new Field('entryId', new Utf8(), false),
        new Field('lorebookId', new Utf8(), false),
        new Field('text', new Utf8(), false),
        new Field(
          'vector',
          new FixedSizeList(dim, new Field('item', new Float32(), false)),
          false,
        ),
      ])
      const table = await db.createTable(
        'lore_entries',
        makeArrowTable(
          [
            {
              entryId: 'e1',
              lorebookId: 'lb1',
              text: 'alpha',
              vector: [1, 0, 0, 0],
            },
          ],
          { schema },
        ),
      )

      await ensureScalarIndexes(table, LORE_SCALAR_INDEX_SPECS)
      assert.equal(await tableHasScalarIndex(table, 'entryId', 'btree'), true)
      assert.equal(await tableHasScalarIndex(table, 'lorebookId', 'bitmap'), true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('soft mode swallows create failures', async () => {
    const fakeTable = {
      listIndices: async () => {
        throw new Error('list_indices_boom')
      },
      createIndex: async () => {
        throw new Error('should_not_run')
      },
    }
    await ensureScalarIndexes(
      fakeTable as never,
      MEMORY_SCALAR_INDEX_SPECS,
      { soft: true },
    )
  })
})
