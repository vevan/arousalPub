import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileContentUrl } from '../src/file-content-url.js'
import {
  decodeFileMediaToken,
  resolveFileIdFromRepairInput,
} from '../src/shared/file-media-token.js'

const TEST_USER = 'f0000001'

describe('file library storage + public media url', () => {
  let tmp: string
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined
  let storage: typeof import('../src/file-library-storage.js')

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'file-library-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    await mkdir(path.join(tmp, TEST_USER, 'files'), { recursive: true })

    storage = await import('../src/file-library-storage.js')
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    await rm(tmp, { recursive: true, force: true })
  })

  it('fileContentUrl is public /api/m token encoding userId+fileId', () => {
    const url = fileContentUrl('a1b2c3d4', TEST_USER)
    assert.match(url, /^\/api\/m\/[A-Za-z0-9_-]+$/)
    const token = url.slice('/api/m/'.length)
    const ref = decodeFileMediaToken(token)
    assert.ok(ref)
    assert.equal(ref.userId, TEST_USER)
    assert.equal(ref.fileId, 'a1b2c3d4')
    assert.equal(url.includes('access_token'), false)
  })

  it('resolveFileIdFromRepairInput accepts hex, path, absolute URL, and rejects foreign user', () => {
    const url = fileContentUrl('a1b2c3d4', TEST_USER)
    const token = url.slice('/api/m/'.length)

    assert.deepEqual(resolveFileIdFromRepairInput('a1b2c3d4', TEST_USER), {
      ok: true,
      fileId: 'a1b2c3d4',
    })
    assert.deepEqual(resolveFileIdFromRepairInput(url, TEST_USER), {
      ok: true,
      fileId: 'a1b2c3d4',
    })
    assert.deepEqual(
      resolveFileIdFromRepairInput(`${url}?size=m&v=1`, TEST_USER),
      { ok: true, fileId: 'a1b2c3d4' },
    )
    assert.deepEqual(
      resolveFileIdFromRepairInput(
        `https://example.test${url}?size=m`,
        TEST_USER,
      ),
      { ok: true, fileId: 'a1b2c3d4' },
    )
    assert.deepEqual(resolveFileIdFromRepairInput(token, TEST_USER), {
      ok: true,
      fileId: 'a1b2c3d4',
    })
    assert.deepEqual(resolveFileIdFromRepairInput(url, 'ffffffff'), {
      ok: false,
      error: 'wrong_user',
    })
    assert.deepEqual(resolveFileIdFromRepairInput('not-a-url', TEST_USER), {
      ok: false,
      error: 'invalid',
    })
    assert.deepEqual(resolveFileIdFromRepairInput(null, TEST_USER), {
      ok: false,
      error: 'invalid',
    })
    assert.deepEqual(resolveFileIdFromRepairInput(`"${url}"`, TEST_USER), {
      ok: true,
      fileId: 'a1b2c3d4',
    })
    assert.deepEqual(
      resolveFileIdFromRepairInput(`<img src="${url}">`, TEST_USER),
      { ok: true, fileId: 'a1b2c3d4' },
    )
  })

  it('create → list → meta → content → patch → delete', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
    ])
    const meta = await storage.createFileLibraryEntry({
      buffer: png,
      filename: 'portrait.png',
      mime: 'image/png',
      name: '立绘',
      tags: ['char', 'main'],
    })
    assert.equal(meta.kind, 'image')
    assert.equal(meta.mime, 'image/png')
    assert.equal(meta.name, '立绘')
    assert.deepEqual(meta.tags, ['char', 'main'])
    assert.equal(meta.size, png.length)

    const listed = await storage.listFileLibrary({ offset: 0, limit: 10 })
    assert.equal(listed.total, 1)
    assert.equal(listed.items[0]?.fileId, meta.fileId)

    const byKind = await storage.listFileLibrary({
      offset: 0,
      limit: 10,
      kind: 'image',
    })
    assert.equal(byKind.total, 1)
    const byDoc = await storage.listFileLibrary({
      offset: 0,
      limit: 10,
      kind: 'document',
    })
    assert.equal(byDoc.total, 0)

    const searched = await storage.listFileLibrary({
      offset: 0,
      limit: 10,
      search: '立绘',
    })
    assert.equal(searched.total, 1)

    const got = await storage.getFileLibraryMeta(meta.fileId)
    assert.ok(got)
    assert.equal(got.fileId, meta.fileId)

    const resolved = await storage.resolveFileLibraryContent(meta.fileId)
    assert.ok(resolved)
    assert.equal(resolved.byteSize, png.length)
    const bytes = await readFile(resolved.contentPath)
    assert.deepEqual(bytes, png)

    const patched = await storage.patchFileLibraryMeta(meta.fileId, {
      name: '立绘-改',
      tags: ['alt'],
    })
    assert.equal(patched.name, '立绘-改')
    assert.deepEqual(patched.tags, ['alt'])

    const deleted = await storage.deleteFileLibraryEntry(meta.fileId)
    assert.equal(deleted, true)
    assert.equal(await storage.getFileLibraryMeta(meta.fileId), null)
    const after = await storage.listFileLibrary({ offset: 0, limit: 10 })
    assert.equal(after.total, 0)
  })

  it('rejects disallowed mime and kind mismatch', async () => {
    await assert.rejects(
      () =>
        storage.createFileLibraryEntry({
          buffer: Buffer.from('exe'),
          filename: 'x.exe',
          mime: 'application/x-msdownload',
        }),
      (e: unknown) =>
        e instanceof storage.FileLibraryError &&
        e.code === 'file_mime_not_allowed',
    )

    await assert.rejects(
      () =>
        storage.createFileLibraryEntry({
          buffer: Buffer.from('%PDF-1.4'),
          filename: 'doc.pdf',
          mime: 'application/pdf',
          kind: 'image',
        }),
      (e: unknown) =>
        e instanceof storage.FileLibraryError && e.code === 'file_kind_mismatch',
    )
  })

  it('rebuilds index from meta.json when index is missing', async () => {
    const meta = await storage.createFileLibraryEntry({
      buffer: Buffer.from('hello markdown'),
      filename: 'note.md',
      mime: 'text/markdown',
    })
    assert.equal(meta.kind, 'document')

    const idxPath = path.join(tmp, TEST_USER, 'files', 'index.json')
    await rm(idxPath, { force: true })

    const rebuilt = await storage.rebuildFileLibraryIndexFromDisk()
    assert.ok(rebuilt.entries.some((e) => e.fileId === meta.fileId))

    const listed = await storage.listFileLibrary({ offset: 0, limit: 50 })
    assert.ok(listed.items.some((e) => e.fileId === meta.fileId))

    await storage.deleteFileLibraryEntry(meta.fileId)
  })

  it('infers kind from extension when mime is octet-stream', async () => {
    const meta = await storage.createFileLibraryEntry({
      buffer: Buffer.from('ID3'),
      filename: 'bgm.mp3',
      mime: 'application/octet-stream',
    })
    assert.equal(meta.kind, 'audio')
    assert.equal(meta.mime, 'audio/mpeg')
    await storage.deleteFileLibraryEntry(meta.fileId)
  })

  it('infers markdown document from .md/.markdown when mime is octet-stream', async () => {
    for (const filename of ['note.md', 'chapter.markdown'] as const) {
      const meta = await storage.createFileLibraryEntry({
        buffer: Buffer.from('---\ntitle: x\n---\n# Body', 'utf8'),
        filename,
        mime: 'application/octet-stream',
      })
      assert.equal(meta.kind, 'document')
      assert.equal(meta.mime, 'text/markdown')
      // 原文落盘保留 front matter；剥离仅发生在 RAG 抽取
      const resolved = await storage.resolveFileLibraryContent(meta.fileId)
      assert.ok(resolved)
      const raw = await readFile(resolved.contentPath, 'utf8')
      assert.match(raw, /^---\n/)
      await storage.deleteFileLibraryEntry(meta.fileId)
    }
  })

  it('corrupt index triggers rebuild via list', async () => {
    const meta = await storage.createFileLibraryEntry({
      buffer: Buffer.from([0x00, 0x00]),
      filename: 'clip.mp4',
      mime: 'video/mp4',
    })
    const idxPath = path.join(tmp, TEST_USER, 'files', 'index.json')
    await writeFile(idxPath, '{not-json', 'utf8')

    const listed = await storage.listFileLibrary({ offset: 0, limit: 50 })
    assert.ok(listed.items.some((e) => e.fileId === meta.fileId))
    await storage.deleteFileLibraryEntry(meta.fileId)
  })

  it('update content keeps fileId and may change display name', async () => {
    const meta = await storage.createFileLibraryEntry({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      filename: 'avatar-v1.png',
      mime: 'image/png',
    })
    assert.equal(meta.name, 'avatar-v1.png')
    const urlBefore = fileContentUrl(meta.fileId, TEST_USER)

    const replaced = await storage.replaceFileLibraryContent(meta.fileId, {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
      filename: 'avatar-v2.png',
      mime: 'image/png',
    })
    assert.equal(replaced.fileId, meta.fileId)
    assert.equal(replaced.name, 'avatar-v2.png')
    assert.equal(replaced.size, 6)
    assert.equal(fileContentUrl(replaced.fileId, TEST_USER), urlBefore)

    const kept = await storage.replaceFileLibraryContent(meta.fileId, {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
      filename: 'avatar-v3.png',
      mime: 'image/png',
      keepName: true,
    })
    assert.equal(kept.name, 'avatar-v2.png')

    await assert.rejects(
      () =>
        storage.replaceFileLibraryContent(meta.fileId, {
          buffer: Buffer.from('%PDF'),
          filename: 'x.pdf',
          mime: 'application/pdf',
        }),
      (e: unknown) =>
        e instanceof storage.FileLibraryError && e.code === 'file_kind_mismatch',
    )

    await storage.deleteFileLibraryEntry(meta.fileId)
  })

  it('resolveFileLibraryMediaResponse streams public content', async () => {
    const media = await import('../src/file-library-media.js')
    const meta = await storage.createFileLibraryEntry({
      buffer: Buffer.from('plain-text-body'),
      filename: 'a.txt',
      mime: 'text/plain',
    })
    const result = await media.resolveFileLibraryMediaResponse(
      TEST_USER,
      meta.fileId,
      undefined,
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.mode, 'stream')
    if (result.mode !== 'stream') return
    assert.equal(result.mime, 'text/plain')
    assert.equal(result.size, Buffer.byteLength('plain-text-body'))
    const chunks: Buffer[] = []
    for await (const chunk of result.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    assert.equal(Buffer.concat(chunks).toString('utf8'), 'plain-text-body')
    await storage.deleteFileLibraryEntry(meta.fileId)
  })

  it('coerces missing or dirty tags on read', async () => {
    const meta = await storage.createFileLibraryEntry({
      buffer: Buffer.from('tagless'),
      filename: 't.txt',
      mime: 'text/plain',
    })
    const metaPath = path.join(
      tmp,
      TEST_USER,
      'files',
      meta.fileId,
      'meta.json',
    )
    const raw = JSON.parse(await readFile(metaPath, 'utf8')) as Record<
      string,
      unknown
    >
    delete raw.tags
    await writeFile(metaPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')

    const got = await storage.getFileLibraryMeta(meta.fileId)
    assert.ok(got)
    assert.deepEqual(got.tags, [])

    const idxPath = path.join(tmp, TEST_USER, 'files', 'index.json')
    const idx = JSON.parse(await readFile(idxPath, 'utf8')) as {
      entries: Array<Record<string, unknown>>
    }
    const ent = idx.entries.find((e) => e.fileId === meta.fileId)
    assert.ok(ent)
    ent.tags = [1, 'ok', '', '  ', 'ok'] as unknown as string[]
    await writeFile(idxPath, `${JSON.stringify(idx, null, 2)}\n`, 'utf8')

    const listed = await storage.listFileLibrary({ offset: 0, limit: 50 })
    const row = listed.items.find((i) => i.fileId === meta.fileId)
    assert.ok(row)
    assert.deepEqual(row.tags, ['ok'])

    await storage.deleteFileLibraryEntry(meta.fileId)
  })

  it('serializes concurrent creates without losing index entries', async () => {
    const n = 8
    const created = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        storage.createFileLibraryEntry({
          buffer: Buffer.from(`c-${i}`),
          filename: `c-${i}.txt`,
          mime: 'text/plain',
        }),
      ),
    )
    assert.equal(new Set(created.map((m) => m.fileId)).size, n)
    const listed = await storage.listFileLibrary({ offset: 0, limit: 100 })
    for (const m of created) {
      assert.ok(listed.items.some((i) => i.fileId === m.fileId))
      await storage.deleteFileLibraryEntry(m.fileId)
    }
  })

  it('delete is idempotent when clearing orphan index entries', async () => {
    const meta = await storage.createFileLibraryEntry({
      buffer: Buffer.from('orphan'),
      filename: 'o.txt',
      mime: 'text/plain',
    })
    await rm(path.join(tmp, TEST_USER, 'files', meta.fileId), {
      recursive: true,
      force: true,
    })
    const first = await storage.deleteFileLibraryEntry(meta.fileId)
    assert.equal(first, true)
    const listed = await storage.listFileLibrary({ offset: 0, limit: 50 })
    assert.equal(
      listed.items.some((i) => i.fileId === meta.fileId),
      false,
    )
    const second = await storage.deleteFileLibraryEntry(meta.fileId)
    assert.equal(second, false)
  })

  it('recreates at preferred free fileId; rejects taken or invalid id', async () => {
    const { FileLibraryError } = await import('../src/file-library-storage.js')
    const { fileContentUrl: contentUrl } = await import(
      '../src/file-content-url.js'
    )

    const first = await storage.createFileLibraryEntry({
      buffer: Buffer.from('v1'),
      filename: 'keep.txt',
      mime: 'text/plain',
      name: '原件',
    })
    const targetId = first.fileId
    const urlBefore = contentUrl(targetId, TEST_USER)

    await storage.deleteFileLibraryEntry(targetId)
    assert.equal(await storage.getFileLibraryMeta(targetId), null)

    const rebuilt = await storage.createFileLibraryEntry({
      buffer: Buffer.from('v2-restored'),
      filename: 'keep.txt',
      mime: 'text/plain',
      name: '重建',
      fileId: targetId,
    })
    assert.equal(rebuilt.fileId, targetId)
    assert.equal(rebuilt.name, '重建')
    assert.equal(contentUrl(rebuilt.fileId, TEST_USER), urlBefore)

    await assert.rejects(
      () =>
        storage.createFileLibraryEntry({
          buffer: Buffer.from('x'),
          filename: 'x.txt',
          mime: 'text/plain',
          fileId: targetId,
        }),
      (e: unknown) =>
        e instanceof FileLibraryError && e.code === 'file_id_taken',
    )

    await assert.rejects(
      () =>
        storage.createFileLibraryEntry({
          buffer: Buffer.from('x'),
          filename: 'x.txt',
          mime: 'text/plain',
          fileId: 'not-hex!',
        }),
      (e: unknown) =>
        e instanceof FileLibraryError && e.code === 'file_invalid_id',
    )

    await storage.deleteFileLibraryEntry(targetId)
  })
})
