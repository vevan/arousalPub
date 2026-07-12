/**
 * Isolated DATA_DIR：index 有 tailChunkFile 但缺 chunk 文件时，
 * messages?tail= 须返回 conversation_chunks_unreadable（禁止静默空 turns）。
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadConversationMessages } from '../conversation-messages-api.js'
import { getUserDataDir } from '../config.js'
import { getCurrentUserId } from '../user-context.js'

const CONV_ID = 'a1b2c3d4'
const convDir = path.join(getUserDataDir(getCurrentUserId()), 'chats', CONV_ID)
await mkdir(convDir, { recursive: true })
await writeFile(
  path.join(convDir, 'index.json'),
  JSON.stringify({
    schemaVersion: 1,
    conversationId: CONV_ID,
    title: 't',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    headChunkFile: 'turn-000000-000099.json',
    tailChunkFile: 'turn-000000-000099.json',
    branches: [],
  }),
  'utf8',
)

const result = await loadConversationMessages(CONV_ID, { tail: '30' })
assert.equal(result.ok, false)
if (!result.ok) {
  assert.equal(result.error, 'conversation_chunks_unreadable')
}
console.log('[chunks-unreadable-integration] ok')
