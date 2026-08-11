import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const TEST_USER = 'b0f0f001'

describe('createEmptyConversationBranch forkMessageId', () => {
  let tmp = ''
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined
  let chatStorage: typeof import('../src/chat-storage.js')
  let chatGroupTurnOps: typeof import('../src/chat-group-turn-ops.js')
  let branches: typeof import('../src/conversation-branches.js')
  let chunkChain: typeof import('../src/chunk-chain.js')

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'branch-fork-msg-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    chatStorage = await import('../src/chat-storage.js')
    chatGroupTurnOps = await import('../src/chat-group-turn-ops.js')
    branches = await import('../src/conversation-branches.js')
    chunkChain = await import('../src/chunk-chain.js')
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    await rm(tmp, { recursive: true, force: true })
  })

  it('rejects unknown forkMessageId; accepts valid and overlays on read', async () => {
    const conversationId = 'c0fork01'
    await chatStorage.createConversationStub(conversationId, 'fork swipe')
    const first = await chatGroupTurnOps.saveFirstTurn({
      conversationId,
      userText: 'u0',
      assistantText: 'a0',
    })
    assert.ok(first)

    const okAppend = await chatGroupTurnOps.appendConversationTurn({
      conversationId,
      userText: 'u1',
      receives: [
        { id: 'recvsw01', content: 'swipe-one' },
        { id: 'recvsw02', content: 'swipe-two' },
      ],
      activeReceiveIndex: 0,
    })
    assert.equal(okAppend, true)

    const mainTurns = await chunkChain.resolveActivePathTurns(conversationId, '')
    assert.equal(mainTurns.length, 2)
    const forkTurn = mainTurns[mainTurns.length - 1]
    assert.ok(forkTurn?.turnId)
    assert.equal(forkTurn.segments[0]?.receives?.length, 2)

    const bad = await branches.createEmptyConversationBranch({
      conversationId,
      forkTurnId: forkTurn.turnId,
      forkMessageId: 'deadbeef',
      setActive: false,
    })
    assert.ok('error' in bad)
    if ('error' in bad) {
      assert.equal(bad.error, 'validation_failed')
      assert.equal(bad.status, 400)
    }

    const created = await branches.createEmptyConversationBranch({
      conversationId,
      forkTurnId: forkTurn.turnId,
      forkMessageId: 'recvsw02',
      label: 'from swipe 2',
      setActive: true,
    })
    assert.ok(!('error' in created))
    if ('error' in created) return
    assert.equal(created.path, 'branch1')
    assert.ok(created.activeBranchPath)

    const onBranch = await chunkChain.resolveActivePathTurns(
      conversationId,
      created.activeBranchPath,
    )
    const forkOnBranch = onBranch.find((t) => t.turnId === forkTurn.turnId)
    assert.ok(forkOnBranch)
    assert.equal(forkOnBranch.segments[0]?.activeReceiveIndex, 1)
    assert.equal(forkOnBranch.segments[0]?.receives[1]?.content, 'swipe-two')

    const stillMain = await chunkChain.resolveActivePathTurns(conversationId, '')
    const forkOnMain = stillMain.find((t) => t.turnId === forkTurn.turnId)
    assert.ok(forkOnMain)
    assert.equal(forkOnMain.segments[0]?.activeReceiveIndex, 0)
  })
})
