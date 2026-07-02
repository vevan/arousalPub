import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
      '../src/chat-storage.js'
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
})
