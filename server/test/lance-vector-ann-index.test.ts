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
  ensureIvfPqIndex,
  isIvfPqIndexType,
  listHasIvfPqIndex,
  tableHasIvfPqIndex,
} from '../src/lance-vector-ann-index.js'

const DIM = 8

function unitVector(i: number, dim: number): number[] {
  const v = new Array(dim).fill(0)
  v[i % dim] = 1 + (i % 7) * 0.01
  return v
}

function docChunkSchema(dim: number): Schema {
  return new Schema([
    new Field('chunkId', new Utf8(), false),
    new Field('kbId', new Utf8(), false),
    new Field('fileId', new Utf8(), false),
    new Field('ordinal', new Int32(), false),
    new Field('text', new Utf8(), false),
    new Field(
      'vector',
      new FixedSizeList(dim, new Field('item', new Float32(), false)),
      false,
    ),
  ])
}

function makeRows(n: number, dim: number) {
  return Array.from({ length: n }, (_, i) => ({
    chunkId: `c${i}`,
    kbId: 'kb1',
    fileId: 'f1',
    ordinal: i,
    text: `chunk text ${i}`,
    vector: unitVector(i, dim),
  }))
}

describe('listHasIvfPqIndex / isIvfPqIndexType', () => {
  it('matches IvfPq and IVF_PQ casings', () => {
    assert.equal(isIvfPqIndexType('IvfPq'), true)
    assert.equal(isIvfPqIndexType('IVF_PQ'), true)
    assert.equal(isIvfPqIndexType('ivf_pq'), true)
    assert.equal(isIvfPqIndexType('BTree'), false)
    assert.equal(
      listHasIvfPqIndex(
        [{ name: 'vector_idx', indexType: 'IvfPq', columns: ['vector'] }],
        'vector',
      ),
      true,
    )
    assert.equal(
      listHasIvfPqIndex(
        [{ name: 'vector_idx', indexType: 'IVF_PQ', columns: ['vector'] }],
        'vector',
      ),
      true,
    )
    assert.equal(
      listHasIvfPqIndex(
        [{ name: 'x', indexType: 'IvfPq', columns: ['other'] }],
        'vector',
      ),
      false,
    )
  })
})

describe('ensureIvfPqIndex', () => {
  it('skips when rowCount below threshold', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lance-ann-skip-'))
    try {
      const db = await lancedb.connect(dir)
      const table = await db.createTable(
        'doc_chunks',
        makeArrowTable(makeRows(16, DIM), { schema: docChunkSchema(DIM) }),
      )
      const created = await ensureIvfPqIndex(table, 'vector', {
        rowCount: 16,
        threshold: 10_000,
      })
      assert.equal(created, false)
      assert.equal(await tableHasIvfPqIndex(table, 'vector'), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('creates IVF_PQ when rows meet injected threshold and is idempotent', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lance-ann-create-'))
    try {
      const db = await lancedb.connect(dir)
      // Lance PQ 训练最少 256 行
      const n = 256
      const table = await db.createTable(
        'doc_chunks',
        makeArrowTable(makeRows(n, DIM), { schema: docChunkSchema(DIM) }),
      )
      const created = await ensureIvfPqIndex(table, 'vector', {
        rowCount: n,
        threshold: 256,
        waitTimeoutSeconds: 120,
      })
      assert.equal(created, true)
      assert.equal(await tableHasIvfPqIndex(table, 'vector'), true)

      const again = await ensureIvfPqIndex(table, 'vector', {
        rowCount: n,
        threshold: 256,
        waitTimeoutSeconds: 120,
      })
      assert.equal(again, false)
      assert.equal(await tableHasIvfPqIndex(table, 'vector'), true)

      const hits = (await table
        .vectorSearch(unitVector(0, DIM))
        .refineFactor(2)
        .limit(5)
        .toArray()) as { chunkId?: string }[]
      assert.ok(hits.length > 0)
      assert.ok(hits.some((h) => String(h.chunkId ?? '').length > 0))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('soft mode swallows create failures', async () => {
    const fakeTable = {
      countRows: async () => 20_000,
      listIndices: async () => {
        throw new Error('list_indices_boom')
      },
      createIndex: async () => {
        throw new Error('should_not_run')
      },
    }
    const created = await ensureIvfPqIndex(fakeTable as never, 'vector', {
      soft: true,
      threshold: 10_000,
    })
    assert.equal(created, false)
  })
})
