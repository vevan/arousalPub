import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const TEST_USER = 'a3000001'

describe('conversation media fileId (M3)', () => {
  let tmp: string
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined
  let parseConversationMediaFileId: typeof import('../src/conversation-media-files.js').parseConversationMediaFileId
  let createFileLibraryEntry: typeof import('../src/file-library-storage.js').createFileLibraryEntry
  let createConversationStub: typeof import('../src/chat-storage.js').createConversationStub
  let readConversationIndex: typeof import('../src/chat-storage.js').readConversationIndex
  let updateConversationBackgroundImageFileId: typeof import('../src/chat-storage.js').updateConversationBackgroundImageFileId
  let updateConversationBgmFileId: typeof import('../src/chat-storage.js').updateConversationBgmFileId

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'conv-media-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    await mkdir(path.join(tmp, TEST_USER, 'files'), { recursive: true })
    await mkdir(path.join(tmp, TEST_USER, 'chats'), { recursive: true })

    ;({ parseConversationMediaFileId } = await import(
      '../src/conversation-media-files.js'
    ))
    ;({ createFileLibraryEntry } = await import('../src/file-library-storage.js'))
    ;({
      createConversationStub,
      readConversationIndex,
      updateConversationBackgroundImageFileId,
      updateConversationBgmFileId,
    } = await import('../src/chat-storage.js'))
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    await rm(tmp, { recursive: true, force: true })
  })

  it('parse clears null/empty; rejects bad id / missing / wrong kind', async () => {
    const cleared = await parseConversationMediaFileId(null, 'image')
    assert.deepEqual(cleared, { ok: true, fileId: null })
    const empty = await parseConversationMediaFileId('  ', 'image')
    assert.deepEqual(empty, { ok: true, fileId: null })

    const bad = await parseConversationMediaFileId('not-hex', 'image')
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.equal(bad.error, 'file_invalid_id')

    const missing = await parseConversationMediaFileId('aaaaaaaa', 'image')
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.error, 'file_not_found')

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const img = await createFileLibraryEntry({
      buffer: png,
      filename: 'bg.png',
      mime: 'image/png',
      name: '背景',
    })
    const asAudio = await parseConversationMediaFileId(img.fileId, 'audio')
    assert.equal(asAudio.ok, false)
    if (!asAudio.ok) assert.equal(asAudio.error, 'file_kind_mismatch')

    const okImg = await parseConversationMediaFileId(img.fileId.toUpperCase(), 'image')
    assert.deepEqual(okImg, { ok: true, fileId: img.fileId })
  })

  it('index write/clear background and bgm fileIds', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const img = await createFileLibraryEntry({
      buffer: png,
      filename: 'wall.png',
      mime: 'image/png',
      name: '墙纸',
    })
    const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
    const audio = await createFileLibraryEntry({
      buffer: mp3,
      filename: 'theme.mp3',
      mime: 'audio/mpeg',
      name: '主题曲',
    })

    const convId = 'c0ffee01'
    await createConversationStub(convId, 'media test')

    const withBg = await updateConversationBackgroundImageFileId(convId, img.fileId)
    assert.equal(withBg?.backgroundImageFileId, img.fileId)
    const withBgm = await updateConversationBgmFileId(convId, audio.fileId)
    assert.equal(withBgm?.bgmFileId, audio.fileId)

    const read = await readConversationIndex(convId)
    assert.equal(read?.backgroundImageFileId, img.fileId)
    assert.equal(read?.bgmFileId, audio.fileId)

    await updateConversationBackgroundImageFileId(convId, null)
    await updateConversationBgmFileId(convId, '')
    const cleared = await readConversationIndex(convId)
    assert.equal(cleared?.backgroundImageFileId, undefined)
    assert.equal(cleared?.bgmFileId, undefined)
  })
})
