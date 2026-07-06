import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { after, before, describe, it } from 'node:test'
import {
  parseStChatJsonl,
  previewStChatImport,
  streamParseStChat,
  streamPreviewStChat,
} from '../src/st-chat-import.js'

const TEST_USER = 'b0000001'

const SAMPLE_JSONL = `{"chat_metadata":{"note":"x"}}
{"name":"Anna","is_user":false,"is_system":true,"send_date":"2026-02-04T04:32:50.667Z","mes":"Hello opening.","gen_started":"2026-02-04T04:32:50.000Z","gen_finished":"2026-02-04T04:32:52.000Z"}
{"name":"User","is_user":true,"is_system":true,"send_date":"2026-02-04T04:34:11.365Z","mes":"Hi there"}
{"name":"Anna","is_user":false,"is_system":true,"send_date":"2026-02-04T04:34:22.607Z","mes":"Reply one.","extra":{"reasoning":"think"},"gen_started":"2026-02-04T04:34:11.233Z","gen_finished":"2026-02-04T04:34:22.607Z"}
{"name":"User","is_user":true,"mes":"Second question"}
{"name":"Anna","is_user":false,"mes":"Reply two."}
`

describe('st-chat-import', () => {
  it('parses opening + user/assistant pairs', () => {
    const parsed = parseStChatJsonl(SAMPLE_JSONL)
    assert.equal(parsed.turns.length, 3)
    assert.equal(parsed.turns[0]!.turnOrdinal, 0)
    assert.equal(parsed.turns[0]!.userText, '')
    assert.equal(parsed.turns[0]!.assistantContent, 'Hello opening.')
    assert.equal(parsed.turns[0]!.durationMs, 2000)
    assert.equal(parsed.turns[1]!.userText, 'Hi there')
    assert.equal(parsed.turns[1]!.assistantContent, 'Reply one.')
    assert.equal(parsed.turns[1]!.reasoning, 'think')
    assert.equal(parsed.turns[2]!.userText, 'Second question')
    assert.equal(parsed.turns[2]!.assistantContent, 'Reply two.')
  })

  it('preview returns turnCount and openingPreview', () => {
    const preview = previewStChatImport(SAMPLE_JSONL)
    assert.equal(preview.turnCount, 3)
    assert.ok(preview.openingPreview.includes('Hello opening'))
  })

  it('stream preview returns counts without retaining messages', async () => {
    const preview = await streamPreviewStChat(Readable.from([SAMPLE_JSONL]))
    assert.equal(preview.turnCount, 3)
    assert.ok(preview.openingPreview.includes('Hello opening'))
    assert.equal(preview.suggestedTitle, '与 Anna 的对话')
  })

  it('stream preview warns on empty input', async () => {
    const preview = await streamPreviewStChat(Readable.from(['']))
    assert.equal(preview.turnCount, 0)
    assert.ok(preview.warnings.some((w) => w.includes('未找到可导入的消息')))
  })

  it('stream parse matches text parse for import fields', async () => {
    const textParsed = parseStChatJsonl(SAMPLE_JSONL)
    const streamParsed = await streamParseStChat(Readable.from([SAMPLE_JSONL]))
    assert.deepEqual(streamParsed.turns, textParsed.turns)
    assert.equal(streamParsed.openingPreview, textParsed.openingPreview)
    assert.equal(streamParsed.suggestedTitle, textParsed.suggestedTitle)
  })

  it('does not treat a non-system leading assistant row as opening', async () => {
    const text = `{"name":"Anna","is_user":false,"mes":"orphan"}
{"name":"User","is_user":true,"mes":"Hi"}
{"name":"Anna","is_user":false,"mes":"Reply"}
`
    const parsed = parseStChatJsonl(text)
    assert.equal(parsed.turns.length, 1)
    assert.equal(parsed.openingPreview, '')
    assert.ok(parsed.warnings.some((w) => w.includes('无对应用户消息')))

    const preview = await streamPreviewStChat(Readable.from([text]))
    assert.equal(preview.turnCount, 1)
    assert.equal(preview.openingPreview, '')
  })

  describe('importTurnsToEmptyConversation (isolated DATA_DIR)', () => {
    let tmp: string
    let prevDataDir: string | undefined
    let prevTestUser: string | undefined

    before(async () => {
      tmp = await mkdtemp(path.join(os.tmpdir(), 'st-chat-import-'))
      prevDataDir = process.env.DATA_DIR
      prevTestUser = process.env.AROUSAL_TEST_USER_ID
      process.env.DATA_DIR = tmp
      process.env.AROUSAL_TEST_USER_ID = TEST_USER
      await mkdir(path.join(tmp, TEST_USER, 'chats'), { recursive: true })
    })

    after(async () => {
      if (prevDataDir === undefined) delete process.env.DATA_DIR
      else process.env.DATA_DIR = prevDataDir
      if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
      else process.env.AROUSAL_TEST_USER_ID = prevTestUser
      await rm(tmp, { recursive: true, force: true })
    })

    it('writes turns to disk', async () => {
      const {
        createConversationStub,
        importTurnsToEmptyConversation,
        readConversationIndex,
        readTailChunk,
      } = await import('../src/chat-storage.js')

      const convId = 'a1b2c3d4'
      await createConversationStub(convId, 'ST test')
      const parsed = parseStChatJsonl(SAMPLE_JSONL)
      const result = await importTurnsToEmptyConversation({
        conversationId: convId,
        speakerCharacterId: 'char0001',
        turns: parsed.turns.map((t) => ({
          turnOrdinal: t.turnOrdinal,
          userText: t.userText,
          receives: [
            {
              id: '',
              content: t.assistantContent,
              ...(t.reasoning ? { reasoning: t.reasoning } : {}),
              ...(t.durationMs
                ? { runtime: { durationMs: t.durationMs } }
                : {}),
            },
          ],
          activeReceiveIndex: 0,
          createdAt: t.createdAt,
        })),
      })
      assert.ok(result)
      assert.equal(result.turnCount, 3)

      const after = await readConversationIndex(convId)
      assert.ok(after?.headChunkFile)
      const tail = await readTailChunk(convId)
      assert.ok(tail)
      assert.equal(tail.turns.length, 3)
      assert.equal(tail.turns[0]!.send.userText, '')
      assert.equal(tail.turns[1]!.receives[0]?.reasoning, 'think')
    })

    it('importStChatFromStream writes via streaming session', async () => {
      const {
        createConversationStub,
        readConversationIndex,
        readTailChunk,
      } = await import('../src/chat-storage.js')
      const { importStChatFromStream } = await import('../src/st-chat-import.js')

      const convId = 'b2c3d4e5'
      await createConversationStub(convId, 'ST stream import')
      const result = await importStChatFromStream({
        conversationId: convId,
        speakerCharacterId: 'char0001',
        stream: Readable.from([SAMPLE_JSONL]),
      })
      assert.ok(result)
      assert.equal(result!.turnCount, 3)
      const after = await readConversationIndex(convId)
      assert.ok(after?.headChunkFile)
      const tail = await readTailChunk(convId)
      assert.equal(tail?.turns.length, 3)
    })
  })
})
