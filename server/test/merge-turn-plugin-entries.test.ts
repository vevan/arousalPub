import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  __resetTurnPluginPoliciesForTest,
  __setTurnPluginPolicyForTest,
} from '../src/plugin-system/turn-plugin-policies.js'
import { runRequestUserAsync } from '../src/user-context.js'
import type { TurnRecord } from '../src/chat-storage.js'
import { testTurn } from './fixtures/turn-record.js'

const TEST_USER = 'b0000001'
const FIXTURE_PLUGIN = 'fixture-receive-scoped'

describe('mergeTurnPluginEntriesAtOrdinal (receive-scoped segment write)', () => {
  let prevDataDir: string | undefined
  let tmp = ''
  let conversationId = ''
  let createConversationStub: typeof import('../src/chat-storage.js').createConversationStub
  let mergeTurnPluginEntriesAtOrdinal: typeof import('../src/chat-storage.js').mergeTurnPluginEntriesAtOrdinal
  let writeChunkFile: typeof import('../src/chat-storage.js').writeChunkFile
  let readChunkContainingOrdinal: typeof import('../src/chunk-chain.js').readChunkContainingOrdinal
  let syncChunkIndexIfDrifted: typeof import('../src/chunk-chain.js').syncChunkIndexIfDrifted
  let chunkStorageRelativePath: typeof import('../src/chunk-path.js').chunkStorageRelativePath

  before(async () => {
    __setTurnPluginPolicyForTest(FIXTURE_PLUGIN, {
      mode: 'receive-scoped',
      receiveIdKey: 'receiveId',
    })
    prevDataDir = process.env.DATA_DIR
    tmp = path.join(process.cwd(), '.tmp', 'merge-turn-plugin-entries-test')
    await rm(tmp, { recursive: true, force: true })
    process.env.DATA_DIR = tmp
    await mkdir(path.join(tmp, TEST_USER, 'chats'), { recursive: true })
    ;({
      createConversationStub,
      mergeTurnPluginEntriesAtOrdinal,
      writeChunkFile,
    } = await import('../src/chat-storage.js'))
    ;({ readChunkContainingOrdinal, syncChunkIndexIfDrifted } = await import('../src/chunk-chain.js'))
    ;({ chunkStorageRelativePath } = await import('../src/chunk-path.js'))

    await runRequestUserAsync(TEST_USER, async () => {
      conversationId = 'a1b2c3d4'
      await createConversationStub(conversationId, 'merge test')
      const turn: TurnRecord = {
        ...testTurn({
          turnId: 'turn01',
          turnOrdinal: 0,
          userText: 'hi',
          segments: [
            {
              id: 'seg0',
              speakerCharacterId: 'char0001',
              receives: [{ id: 'recv-a', content: 'Alice says hi' }],
              activeReceiveIndex: 0,
            },
            {
              id: 'seg1',
              speakerCharacterId: 'char0002',
              receives: [{ id: 'recv-b', content: 'Betty says hey' }],
              activeReceiveIndex: 0,
            },
          ],
          activeSegmentIndex: 1,
          speakerCharacterId: 'char0002',
        }),
        plugins: [
          {
            pluginId: FIXTURE_PLUGIN,
            schemaVersion: 1,
            payload: { note: 'on-a', receiveId: 'recv-a' },
          },
          {
            pluginId: FIXTURE_PLUGIN,
            schemaVersion: 1,
            payload: { note: 'on-b', receiveId: 'recv-b' },
          },
        ],
      }
      const chunk = {
        schemaVersion: 1 as const,
        meta: {
          chunkId: 'turn-000000-000099',
          ordinalRange: { start: 0, end: 0 },
          links: { previous: null, next: null, branches: [] },
        },
        turns: [turn],
      }
      await writeChunkFile(
        conversationId,
        chunkStorageRelativePath('', 'turn-000000-000099.json'),
        chunk,
      )
      await syncChunkIndexIfDrifted(conversationId, { force: true })
    })
  })

  after(async () => {
    await rm(tmp, { recursive: true, force: true })
    __resetTurnPluginPoliciesForTest()
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
  })

  it('updates non-active segment receive by receiveId', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const status = await mergeTurnPluginEntriesAtOrdinal(
        conversationId,
        0,
        [
          {
            pluginId: FIXTURE_PLUGIN,
            schemaVersion: 1,
            payload: { note: 'on-a-updated', receiveId: 'recv-a' },
          },
        ],
        {
          receiveContent: {
            receiveId: 'recv-a',
            content: 'Alice updated body',
          },
        },
      )
      assert.equal(status, 'ok')
      const located = await readChunkContainingOrdinal(conversationId, 0)
      assert.ok(located)
      const disk = located.chunk.turns[0]!
      assert.equal(disk.segments[0]!.receives[0]!.content, 'Alice updated body')
      assert.equal(disk.segments[1]!.receives[0]!.content, 'Betty says hey')
      const plugins = disk.plugins as { payload?: { receiveId?: string; note?: string } }[]
      const hit = plugins.find((p) => p.payload?.receiveId === 'recv-a')
      const other = plugins.find((p) => p.payload?.receiveId === 'recv-b')
      assert.equal(hit?.payload?.note, 'on-a-updated')
      assert.equal(other?.payload?.note, 'on-b')
    })
  })

  it('returns not_found for unknown receiveId', async () => {
    await runRequestUserAsync(TEST_USER, async () => {
      const status = await mergeTurnPluginEntriesAtOrdinal(
        conversationId,
        0,
        [],
        {
          receiveContent: {
            receiveId: 'missing-id',
            content: 'nope',
          },
        },
      )
      assert.equal(status, 'not_found')
    })
  })
})
