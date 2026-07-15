import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const TEST_USER = 'a5000001'

describe('file library references (M5)', () => {
  let tmp: string
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined
  let createFileLibraryEntry: typeof import('../src/file-library-storage.js').createFileLibraryEntry
  let getFileLibraryMeta: typeof import('../src/file-library-storage.js').getFileLibraryMeta
  let findFileLibraryReferences: typeof import('../src/file-library-references.js').findFileLibraryReferences
  let deleteFileLibraryEntryWithReferenceCheck: typeof import('../src/file-library-references.js').deleteFileLibraryEntryWithReferenceCheck
  let FileLibraryInUseError: typeof import('../src/file-library-references.js').FileLibraryInUseError
  let createConversationStub: typeof import('../src/chat-storage.js').createConversationStub
  let updateConversationBackgroundImageFileId: typeof import('../src/chat-storage.js').updateConversationBackgroundImageFileId
  let updateConversationBgmFileId: typeof import('../src/chat-storage.js').updateConversationBgmFileId
  let readConversationIndex: typeof import('../src/chat-storage.js').readConversationIndex
  let putCharacterImageFiles: typeof import('../src/character-storage.js').putCharacterImageFiles
  let getCharacterImageFiles: typeof import('../src/character-storage.js').getCharacterImageFiles
  let importCharacterCard: typeof import('../src/character-storage.js').importCharacterCard

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'file-refs-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    await mkdir(path.join(tmp, TEST_USER, 'files'), { recursive: true })
    await mkdir(path.join(tmp, TEST_USER, 'chats'), { recursive: true })
    await mkdir(path.join(tmp, TEST_USER, 'characters'), { recursive: true })

    ;({ createFileLibraryEntry, getFileLibraryMeta } = await import(
      '../src/file-library-storage.js'
    ))
    ;({
      findFileLibraryReferences,
      deleteFileLibraryEntryWithReferenceCheck,
      FileLibraryInUseError,
    } = await import('../src/file-library-references.js'))
    ;({
      createConversationStub,
      updateConversationBackgroundImageFileId,
      updateConversationBgmFileId,
      readConversationIndex,
    } = await import('../src/chat-storage.js'))
    ;({
      putCharacterImageFiles,
      getCharacterImageFiles,
      importCharacterCard,
    } = await import('../src/character-storage.js'))
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    await rm(tmp, { recursive: true, force: true })
  })

  it('lists character + conversation refs; force clears then deletes', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const img = await createFileLibraryEntry({
      buffer: png,
      filename: 'bg.png',
      mime: 'image/png',
      name: '背景图',
    })
    const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
    const audio = await createFileLibraryEntry({
      buffer: mp3,
      filename: 'bgm.mp3',
      mime: 'audio/mpeg',
      name: 'BGM',
    })

    const char = await importCharacterCard({
      name: '测试角色',
      description: 'd',
      personality: 'p',
      scenario: '',
      first_mes: 'hi',
      mes_example: '',
      system_prompt: '',
      post_history_instructions: '',
      tags: [],
      creator_notes: '',
      alternate_greetings: [],
      character_book: { entries: [] },
      extensions: {},
    })

    const bound = await putCharacterImageFiles(char.id, [img.fileId])
    assert.equal(bound.ok, true)

    const convId = 'c0ffee05'
    await createConversationStub(convId, '引用测试会话')
    await updateConversationBackgroundImageFileId(convId, img.fileId)
    await updateConversationBgmFileId(convId, audio.fileId)

    const imgRefs = await findFileLibraryReferences(img.fileId)
    assert.equal(imgRefs.length, 2)
    assert.ok(imgRefs.some((r) => r.kind === 'character_image_file'))
    assert.ok(imgRefs.some((r) => r.kind === 'conversation_background'))

    await assert.rejects(
      () => deleteFileLibraryEntryWithReferenceCheck(img.fileId, { force: false }),
      (e: unknown) => e instanceof FileLibraryInUseError,
    )
    assert.ok(await getFileLibraryMeta(img.fileId))

    const deleted = await deleteFileLibraryEntryWithReferenceCheck(img.fileId, {
      force: true,
    })
    assert.equal(deleted, true)
    assert.equal(await getFileLibraryMeta(img.fileId), null)

    const afterChar = await getCharacterImageFiles(char.id)
    assert.ok(afterChar)
    assert.equal(afterChar.fileIds.includes(img.fileId), false)

    const afterConv = await readConversationIndex(convId)
    assert.equal(afterConv?.backgroundImageFileId, undefined)
    assert.equal(afterConv?.bgmFileId, audio.fileId)

    const audioDeleted = await deleteFileLibraryEntryWithReferenceCheck(
      audio.fileId,
      { force: true },
    )
    assert.equal(audioDeleted, true)
    const afterBgm = await readConversationIndex(convId)
    assert.equal(afterBgm?.bgmFileId, undefined)
  })

  it('deletes with no refs without force', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const img = await createFileLibraryEntry({
      buffer: png,
      filename: 'orphan.png',
      mime: 'image/png',
      name: '孤立',
    })
    const refs = await findFileLibraryReferences(img.fileId)
    assert.equal(refs.length, 0)
    const ok = await deleteFileLibraryEntryWithReferenceCheck(img.fileId, {
      force: false,
    })
    assert.equal(ok, true)
    assert.equal(await getFileLibraryMeta(img.fileId), null)
  })

  it('force clears dangling refs when file already gone', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const img = await createFileLibraryEntry({
      buffer: png,
      filename: 'ghost.png',
      mime: 'image/png',
      name: '幽灵',
    })
    const { deleteFileLibraryEntry } = await import(
      '../src/file-library-storage.js'
    )
    const char = await importCharacterCard({
      name: '幽灵角色',
      description: 'd',
      personality: 'p',
      scenario: '',
      first_mes: 'hi',
      mes_example: '',
      system_prompt: '',
      post_history_instructions: '',
      tags: [],
      creator_notes: '',
      alternate_greetings: [],
      character_book: { entries: [] },
      extensions: {},
    })
    assert.equal((await putCharacterImageFiles(char.id, [img.fileId])).ok, true)

    // 模拟 M1–M3 无引用扫描直接删文件，留下悬空绑定
    assert.equal(await deleteFileLibraryEntry(img.fileId), true)
    assert.equal(await getFileLibraryMeta(img.fileId), null)
    const dangling = await getCharacterImageFiles(char.id)
    assert.ok(dangling?.fileIds.includes(img.fileId))

    const ok = await deleteFileLibraryEntryWithReferenceCheck(img.fileId, {
      force: true,
    })
    assert.equal(ok, true)
    const after = await getCharacterImageFiles(char.id)
    assert.equal(after?.fileIds.includes(img.fileId), false)

    // force 且无文件无引用 → 失败
    const noop = await deleteFileLibraryEntryWithReferenceCheck(img.fileId, {
      force: true,
    })
    assert.equal(noop, false)
  })
})
