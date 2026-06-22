/**
 * 分支审计修复验证 — 独立进程 + 空 DATA_DIR。
 */
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { generateShortId } from '../short-id.js'
import { ensureDataSkeletonForUser } from '../config.js'
import { runRequestUserAsync } from '../user-context.js'
import {
  appendConversationTurn,
  chatListEntryFromIndex,
  conversationDir,
  createConversationStub,
  readConversationIndex,
  saveFirstTurn,
  upsertChatListEntry,
  writeChunkFile,
  writeConversationIndex,
} from '../chat-storage.js'
import {
  collectRegisteredBranchPaths,
  readChunkContainingOrdinal,
  readChunkFileAt,
  resolveActivePathTurns,
} from '../chunk-chain.js'
import {
  createEmptyConversationBranch,
  deleteConversationBranch,
  getConversationBranchTree,
  isTurnIdReferencedByBranchRegistry,
  repairBranchRegistryLabelDrift,
  rebuildBranchForkTurnIdIndex,
  rollbackDeleteBranchRegistry,
  updateConversationActiveBranchPath,
} from '../conversation-branches.js'
import { chunkStorageRelativePath } from '../chunk-path.js'

const TEST_USER = process.env.AROUSAL_TEST_USER_ID?.trim() || 'b0000001'

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function runAuditIntegration(): Promise<void> {
  await ensureDataSkeletonForUser(TEST_USER)

  const conversationId = generateShortId()
  await createConversationStub(conversationId, 'branch audit fixes')

  const first = await saveFirstTurn({
    conversationId,
    userText: 'u0',
    assistantText: 'a0',
  })
  assert.ok(first)

  const mainTurns = await resolveActivePathTurns(conversationId, '')
  const forkTurn = mainTurns[0]!

  const created = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: forkTurn.turnId,
    label: 'Audit Branch',
  })
  assert.ok(!('error' in created))

  let rootIdx = await readConversationIndex(conversationId)
  assert.ok(rootIdx?.branchForkTurnIds?.includes(forkTurn.turnId))

  assert.equal(await isTurnIdReferencedByBranchRegistry(conversationId, forkTurn.turnId), true)

  const tree = await getConversationBranchTree(conversationId)
  assert.ok(!('error' in tree))
  const branchNode = tree.nodes[0]!.children[0]!
  assert.equal(branchNode.turnCount, 0)
  assert.equal(branchNode.mergedTurnCount, forkTurn.turnOrdinal)

  const deleted = await deleteConversationBranch(conversationId, 'branch1')
  assert.ok(!('error' in deleted))
  assert.equal(deleted.dirCleanupFailed, undefined)

  const paths = await collectRegisteredBranchPaths(conversationId)
  assert.ok(!paths.includes('branch1'))
  assert.equal(await pathExists(path.join(conversationDir(conversationId), 'branch1')), false)

  rootIdx = await readConversationIndex(conversationId)
  assert.ok(!rootIdx?.branchForkTurnIds?.includes(forkTurn.turnId))
  assert.equal(await isTurnIdReferencedByBranchRegistry(conversationId, forkTurn.turnId), false)

  const recreated = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: forkTurn.turnId,
    label: 'Drift Test',
  })
  assert.ok(!('error' in recreated))

  const located = await readChunkContainingOrdinal(
    conversationId,
    forkTurn.turnOrdinal,
    '',
  )
  assert.ok(located)
  const chunk = await readChunkFileAt(
    conversationId,
    located.branchPath,
    located.fileName,
  )
  assert.ok(chunk)
  const links = chunk.meta.links ?? { previous: null, next: null, branches: [] }
  const branches = Array.isArray(links.branches) ? links.branches.slice() : []
  const entry = branches.find(
    (e) => e && typeof e === 'object' && (e as { path?: string }).path === 'branch1',
  )
  assert.ok(entry && typeof entry === 'object')
  ;(entry as { label?: string }).label = 'Drifted Label'
  await writeChunkFile(
    conversationId,
    chunkStorageRelativePath(located.branchPath, located.fileName),
    {
      ...chunk,
      meta: {
        ...chunk.meta,
        links: { ...links, branches },
      },
    },
  )

  const driftResult = await repairBranchRegistryLabelDrift(conversationId)
  assert.equal(driftResult.repaired, 1)
  assert.equal(driftResult.failed, 0)

  const rebuilt = await rebuildBranchForkTurnIdIndex(conversationId)
  assert.ok(rebuilt.includes(forkTurn.turnId))

  await deleteConversationBranch(conversationId, 'branch1')

  await updateConversationActiveBranchPath(conversationId, '')
  const branchA = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: forkTurn.turnId,
    label: 'Sibling A',
    setActive: false,
  })
  assert.ok(!('error' in branchA))
  const branchB = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: forkTurn.turnId,
    label: 'Sibling B',
    setActive: false,
  })
  assert.ok(!('error' in branchB))
  assert.equal(branchA.path, 'branch1')
  assert.equal(branchB.path, 'branch2')
  assert.equal(await isTurnIdReferencedByBranchRegistry(conversationId, forkTurn.turnId), true)

  const delA = await deleteConversationBranch(conversationId, 'branch1')
  assert.ok(!('error' in delA))
  assert.equal(
    await isTurnIdReferencedByBranchRegistry(conversationId, forkTurn.turnId),
    true,
    'same fork still referenced by branch2',
  )

  const convNested = generateShortId()
  await createConversationStub(convNested, 'nested fork index')
  await saveFirstTurn({ conversationId: convNested, userText: 'u0', assistantText: 'a0' })
  await appendConversationTurn({
    conversationId: convNested,
    userText: 'u1',
    receives: [{ id: '', content: 'a1' }],
    activeReceiveIndex: 0,
  })
  const nestedFork = (await resolveActivePathTurns(convNested, ''))[1]!
  await createEmptyConversationBranch({
    conversationId: convNested,
    forkTurnId: nestedFork.turnId,
    label: 'L1',
  })
  await appendConversationTurn({
    conversationId: convNested,
    userText: 'u-b1',
    receives: [{ id: '', content: 'a-b1' }],
    activeReceiveIndex: 0,
  })
  const deepFork = (await resolveActivePathTurns(convNested, 'branch1')).at(-1)!
  assert.ok(deepFork)
  await createEmptyConversationBranch({
    conversationId: convNested,
    forkTurnId: deepFork.turnId,
    label: 'L2',
  })
  const nestedIdx = await readConversationIndex(convNested)
  assert.equal(nestedIdx?.branchForkTurnIds?.length, 2)

  await deleteConversationBranch(convNested, 'branch1')
  const afterNested = await readConversationIndex(convNested)
  assert.deepEqual(afterNested?.branchForkTurnIds ?? [], [])
  assert.equal(await isTurnIdReferencedByBranchRegistry(convNested, nestedFork.turnId), false)
  assert.equal(await isTurnIdReferencedByBranchRegistry(convNested, deepFork.turnId), false)

  const rollbackConv = generateShortId()
  await createConversationStub(rollbackConv, 'delete fork chunk rollback')
  await saveFirstTurn({
    conversationId: rollbackConv,
    userText: 'u0',
    assistantText: 'a0',
  })
  const rollbackFork = (await resolveActivePathTurns(rollbackConv, ''))[0]!
  const rollbackBranch = await createEmptyConversationBranch({
    conversationId: rollbackConv,
    forkTurnId: rollbackFork.turnId,
    label: 'Rollback',
  })
  assert.ok(!('error' in rollbackBranch))

  const rootBefore = await readConversationIndex(rollbackConv)
  assert.ok(rootBefore)
  const rawEntry = rootBefore.branches?.[0]
  assert.ok(rawEntry)
  const savedEntry = {
    forkTurnId: rollbackFork.turnId,
    path: 'branch1',
    label: 'Rollback',
  }
  const forkLocated = await readChunkContainingOrdinal(
    rollbackConv,
    rollbackFork.turnOrdinal,
    '',
  )
  assert.ok(forkLocated)

  const stripped: typeof rootBefore = {
    ...rootBefore,
    branches: [],
    updatedAt: new Date().toISOString(),
  }
  await writeConversationIndex(rollbackConv, stripped)
  await upsertChatListEntry(chatListEntryFromIndex(stripped), stripped)
  assert.deepEqual(await collectRegisteredBranchPaths(rollbackConv), [])

  const rollbackResult = await rollbackDeleteBranchRegistry(rollbackConv, {
    parentBranchPath: '',
    segment: 'branch1',
    savedEntry,
    chunkBranchPath: forkLocated.branchPath,
    chunkFileName: forkLocated.fileName,
  })
  assert.equal(rollbackResult.ok, true)
  assert.equal(rollbackResult.parentRestored, true)
  assert.equal(rollbackResult.forkChunkRestored, true)
  assert.deepEqual(await collectRegisteredBranchPaths(rollbackConv), ['branch1'])
  assert.equal(
    await isTurnIdReferencedByBranchRegistry(rollbackConv, rollbackFork.turnId),
    true,
  )

  // eslint-disable-next-line no-console
  console.log('[branch-delete-rollback-integration] ok')

  // eslint-disable-next-line no-console
  console.log('[branch-audit-integration] ok')
}

function main(): Promise<void> {
  return runRequestUserAsync(TEST_USER, runAuditIntegration)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
