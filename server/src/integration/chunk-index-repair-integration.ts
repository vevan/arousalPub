/**
 * S5 chunk index repair 集成脚本 — 独立进程 + DATA_DIR。
 */
import assert from 'node:assert/strict'
import { ensureDataSkeletonForUser } from '../config.js'
import { runRequestUserAsync } from '../user-context.js'
import { generateShortId } from '../short-id.js'
import {
  appendConversationTurn,
  createConversationStub,
  readBranchConversationIndex,
  saveFirstTurn,
  writeBranchConversationIndex,
  writeChunkFile,
} from '../chat-storage.js'
import {
  readAllTurns,
  rebuildHeadTailFromLinks,
  repairConversationChunkIndex,
  syncChunkIndexIfDrifted,
} from '../chunk-chain.js'
import { createEmptyConversationBranch } from '../conversation-branches.js'

const TEST_USER = process.env.AROUSAL_TEST_USER_ID?.trim() || 'b0000001'

function emptyChunkMeta(rangeStart: number, previous: string | null) {
  return {
    chunkId: `turn-${String(rangeStart).padStart(6, '0')}-${String(rangeStart + 99).padStart(6, '0')}`,
    ordinalRange: { start: rangeStart, end: rangeStart + 99 },
    turnsPerFile: 100,
    links: { previous, next: null, branches: [] as unknown[] },
  }
}

async function main() {
  await runRequestUserAsync(TEST_USER, async () => {
    ensureDataSkeletonForUser(TEST_USER)

    const convId = generateShortId()
    await createConversationStub(convId, 'index repair test')
    const first = await saveFirstTurn({
      conversationId: convId,
      userText: 'main turn 0',
      assistantText: 'reply 0',
    })
    assert.ok(first)

    const mainRebuild = await rebuildHeadTailFromLinks(convId, '')
    assert.equal(mainRebuild.chunkFileCount, 1)
    assert.equal(mainRebuild.headChunkFile, 'turn-000000-000099.json')
    assert.equal(mainRebuild.tailChunkFile, 'turn-000000-000099.json')

    const mainTurns = await readAllTurns(convId)
    const forkTurn = mainTurns[0]!
    assert.ok(forkTurn.turnId)

    const branch = await createEmptyConversationBranch({
      conversationId: convId,
      forkTurnId: forkTurn.turnId,
      setActive: true,
    })
    assert.ok('path' in branch)
    assert.equal(branch.path, 'branch1')

    await appendConversationTurn({
      conversationId: convId,
      userText: 'branch turn 1',
      receives: [{ id: '', content: 'branch reply' }],
      activeReceiveIndex: 0,
      branchPath: 'branch1',
    })

    const branchRebuild = await rebuildHeadTailFromLinks(convId, 'branch1')
    assert.equal(branchRebuild.chunkFileCount, 1)
    assert.ok(branchRebuild.tailChunkFile?.startsWith('turn-'))
    assert.equal(branchRebuild.brokenChain, false)

    const mainAfterBranch = await rebuildHeadTailFromLinks(convId, '')
    assert.equal(mainAfterBranch.chunkFileCount, 1)
    assert.equal(mainAfterBranch.tailChunkFile, 'turn-000000-000099.json')

    const branchIdx = await readBranchConversationIndex(convId, 'branch1')
    assert.ok(branchIdx)
    const correctTail = branchIdx!.tailChunkFile
    branchIdx!.tailChunkFile = 'turn-000100-000199.json'
    await writeBranchConversationIndex(convId, 'branch1', branchIdx!)

    const drifted = await readBranchConversationIndex(convId, 'branch1')
    assert.equal(drifted?.tailChunkFile, 'turn-000100-000199.json')

    const repaired = await repairConversationChunkIndex(convId)
    assert.equal(repaired.ok, true)
    assert.equal(repaired.repaired, true)
    assert.ok((repaired.branchScopesRepaired ?? 0) >= 1)

    const fixed = await readBranchConversationIndex(convId, 'branch1')
    assert.equal(fixed?.tailChunkFile, correctTail)

    const branchIdx2 = await readBranchConversationIndex(convId, 'branch1')
    branchIdx2!.headChunkFile = null
    await writeBranchConversationIndex(convId, 'branch1', branchIdx2!)

    const synced = await syncChunkIndexIfDrifted(convId, { force: true })
    assert.equal(synced, true)
    const afterSync = await readBranchConversationIndex(convId, 'branch1')
    assert.equal(afterSync?.headChunkFile, correctTail)
    assert.equal(afterSync?.tailChunkFile, correctTail)

    const decoyName = 'turn-000200-000299.json'
    await writeChunkFile(convId, `branch1/${decoyName}`, {
      schemaVersion: 1,
      meta: emptyChunkMeta(200, null),
      turns: [],
    })
    const branchWithDecoy = await rebuildHeadTailFromLinks(convId, 'branch1')
    assert.equal(branchWithDecoy.chunkFileCount, 2)

    console.log('[chunk-index-repair-integration] ok')
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
