import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const TEST_USER = 'b0000001'

describe('chat.index.json write lock', () => {
  let tmp: string
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'chat-list-lock-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    await mkdir(path.join(tmp, TEST_USER, 'chats'), { recursive: true })
    await writeFile(
      path.join(tmp, TEST_USER, 'chats', 'chat.index.json'),
      JSON.stringify({ schemaVersion: 1, conversations: [] }, null, 2),
      'utf8',
    )
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    await rm(tmp, { recursive: true, force: true })
  })

  it('keeps all entries when upserting concurrently', async () => {
    const { upsertChatListEntry, readChatList } = await import(
      '../src/chat-storage.js',
    )
    const ids = ['aaa11111', 'bbb22222', 'ccc33333', 'ddd44444', 'eee55555']
    await Promise.all(
      ids.map((conversationId, i) =>
        upsertChatListEntry({
          conversationId,
          title: `conv-${i}`,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        }),
      ),
    )

    const list = await readChatList()
    assert.equal(list.conversations.length, ids.length)
    for (const id of ids) {
      assert.ok(list.conversations.some((c) => c.conversationId === id))
    }

    const raw = await readFile(
      path.join(tmp, TEST_USER, 'chats', 'chat.index.json'),
      'utf8',
    )
    const doc = JSON.parse(raw) as { conversations: { conversationId: string }[] }
    assert.equal(doc.conversations.length, ids.length)
  })

  it('CL4: upsert does not reconcile external dirs; explicit reconcile self-heals', async () => {
    const { upsertChatListEntry, readChatList, reconcileChatListWithDisk } =
      await import('../src/chat-storage.js')
    const listPath = path.join(tmp, TEST_USER, 'chats', 'chat.index.json')
    // 外部直接创建会话目录（不经 upsert，模拟 Syncthing / 手工落盘）
    const extId = 'f00d1234'
    await mkdir(path.join(tmp, TEST_USER, 'chats', extId), { recursive: true })
    await writeFile(
      path.join(tmp, TEST_USER, 'chats', extId, 'index.json'),
      JSON.stringify({
        schemaVersion: 1,
        conversationId: extId,
        title: 'ext',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        headChunkFile: null,
        tailChunkFile: null,
        backupSettings: { everyNRounds: 0, maxKeptBackups: 0 },
        branches: [],
        auditDebug: { enabled: false, maxStored: 20 },
      }),
      'utf8',
    )
    await upsertChatListEntry({
      conversationId: 'fff66666',
      title: 'conv-f',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    let doc = JSON.parse(await readFile(listPath, 'utf8')) as {
      conversations: { conversationId: string }[]
    }
    assert.ok(doc.conversations.some((c) => c.conversationId === 'fff66666'))
    assert.ok(!doc.conversations.some((c) => c.conversationId === extId))
    // 显式 reconcile 后外部目录补入
    await reconcileChatListWithDisk()
    doc = JSON.parse(await readFile(listPath, 'utf8')) as {
      conversations: { conversationId: string }[]
    }
    assert.ok(doc.conversations.some((c) => c.conversationId === extId))
    // readChatList 也返回补入后的完整列表
    const list = await readChatList()
    assert.ok(list.conversations.some((c) => c.conversationId === extId))
  })

  it('CL2: identical upsert skips write (mtime unchanged); changed entry writes', async () => {
    const { upsertChatListEntry } = await import('../src/chat-storage.js')
    const listPath = path.join(tmp, TEST_USER, 'chats', 'chat.index.json')
    const entry = {
      conversationId: 'aaa11111',
      title: 'conv-0',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    await upsertChatListEntry(entry)
    const mtimeBefore = (await stat(listPath)).mtimeMs
    await upsertChatListEntry(entry)
    assert.equal((await stat(listPath)).mtimeMs, mtimeBefore)
    // 有变化仍整写
    await upsertChatListEntry({
      ...entry,
      updatedAt: '2026-01-03T00:00:00.000Z',
    })
    assert.ok((await stat(listPath)).mtimeMs > mtimeBefore)
  })
  it('CL5: turnStats sets active path stats without chunk-chain scan', async () => {
    const { upsertChatListEntry, readChatList } = await import('../src/chat-storage.js')
    // 增量形式：activeTurnCount 在既有值上 +2
    await upsertChatListEntry(
      { conversationId: 'eee55555', title: 'conv-4', updatedAt: '2026-01-06T00:00:00.000Z' },
      undefined,
      { turnStats: { appendedTurnCount: 2, lastChatAt: '2026-01-06T01:00:00.000Z' } },
    )
    let list = await readChatList()
    let e = list.conversations.find((c) => c.conversationId === 'eee55555')
    assert.equal(e?.activeTurnCount, 2)
    assert.equal(e?.lastChatAt, '2026-01-06T01:00:00.000Z')
    // 绝对值形式：lastChatAt 为空且 count>0 时回退 updatedAt
    await upsertChatListEntry(
      { conversationId: 'eee55555', title: 'conv-4', updatedAt: '2026-01-06T02:00:00.000Z' },
      undefined,
      { turnStats: { turnCount: 7, lastChatAt: null } },
    )
    list = await readChatList()
    e = list.conversations.find((c) => c.conversationId === 'eee55555')
    assert.equal(e?.activeTurnCount, 7)
    assert.equal(e?.lastChatAt, '2026-01-06T02:00:00.000Z')
  })

  it('CL3: batch upsert writes once and skips no-change batch', async () => {
    const { upsertChatListEntries, readChatList } = await import('../src/chat-storage.js')
    const listPath = path.join(tmp, TEST_USER, 'chats', 'chat.index.json')
    const before = (await stat(listPath)).mtimeMs
    await upsertChatListEntries([
      { conversationId: 'b00b1234', title: 'batch-1', updatedAt: '2026-01-07T00:00:00.000Z' },
      { conversationId: 'c0ffee99', title: 'batch-2', updatedAt: '2026-01-07T00:01:00.000Z' },
    ])
    assert.ok((await stat(listPath)).mtimeMs > before)
    const list = await readChatList()
    assert.ok(list.conversations.some((c) => c.conversationId === 'b00b1234'))
    assert.ok(list.conversations.some((c) => c.conversationId === 'c0ffee99'))
    // 无变化批 → 跳过整写
    const m2 = (await stat(listPath)).mtimeMs
    await upsertChatListEntries([
      { conversationId: 'b00b1234', title: 'batch-1', updatedAt: '2026-01-07T00:00:00.000Z' },
    ])
    assert.equal((await stat(listPath)).mtimeMs, m2)
  })

  it('CL1: corrupt JSON degrades on upsert and surfaces on read', async () => {
    const { upsertChatListEntry, readChatList } = await import('../src/chat-storage.js')
    const listPath = path.join(tmp, TEST_USER, 'chats', 'chat.index.json')
    await writeFile(listPath, '{ this is not json', 'utf8')
    // upsert 路径 degrade：不抛错、不把坏文件覆盖成空列表
    await upsertChatListEntry({
      conversationId: 'bbb22222',
      title: 'conv-b',
      updatedAt: '2026-01-04T00:00:00.000Z',
    })
    assert.equal(await readFile(listPath, 'utf8'), '{ this is not json')
    // read 路径可观测失败
    await assert.rejects(readChatList())
    // 恢复：删除坏文件，upsert 以 ENOENT → 空列表重建
    await rm(listPath, { force: true })
    await upsertChatListEntry({
      conversationId: 'bbb22222',
      title: 'conv-b',
      updatedAt: '2026-01-04T00:00:00.000Z',
    })
    const doc = JSON.parse(await readFile(listPath, 'utf8')) as {
      conversations: { conversationId: string }[]
    }
    assert.ok(doc.conversations.some((c) => c.conversationId === 'bbb22222'))
  })

  it('CL1: missing chat.index.json reads as empty and is recreated on upsert', async () => {
    const { upsertChatListEntry, readChatList } = await import('../src/chat-storage.js')
    const listPath = path.join(tmp, TEST_USER, 'chats', 'chat.index.json')
    // 清掉此前外部目录，避免 reconcile 自愈从磁盘补回
    await rm(path.join(tmp, TEST_USER, 'chats', 'f00d1234'), {
      recursive: true,
      force: true,
    })
    await rm(listPath, { force: true })
    const list = await readChatList()
    assert.deepEqual(list.conversations, [])
    await upsertChatListEntry({
      conversationId: 'ccc33333',
      title: 'conv-c',
      updatedAt: '2026-01-05T00:00:00.000Z',
    })
    const doc = JSON.parse(await readFile(listPath, 'utf8')) as {
      conversations: { conversationId: string }[]
    }
    assert.ok(doc.conversations.some((c) => c.conversationId === 'ccc33333'))
  })
})