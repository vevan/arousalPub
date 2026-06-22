/**
 * 分支 DELETE + Memory Lance 集成 — 独立进程 + DATA_DIR。
 */
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { ensureDataSkeletonForUser } from '../config.js'
import { runRequestUserAsync } from '../user-context.js'
import { generateShortId } from '../short-id.js'
import {
  appendConversationTurn,
  conversationDir,
  createConversationStub,
  getTurnUserText,
  readConversationIndex,
  saveFirstTurn,
} from '../chat-storage.js'
import {
  collectRegisteredBranchPaths,
  enumerateAllChunkChains,
  readAllTurns,
  readChunkFileAt,
  resolveActivePathTurns,
} from '../chunk-chain.js'
import {
  createEmptyConversationBranch,
  deleteConversationBranch,
  updateConversationActiveBranchPath,
} from '../conversation-branches.js'
import {
  filterEmbeddableTurns,
  planConversationMemoryReindex,
  reindexConversationMemory,
} from '../memory-index.js'
import {
  replaceTurnMemoryIndex,
  searchTurnMemoryVectors,
  type TurnMemoryRow,
} from '../memory-store.js'
import { turnEmbeddingCorpus } from '../turn-memory-xml.js'
import { updateGlobalEmbeddingApiSettings } from '../user-preferences-file.js'

const TEST_USER = process.env.AROUSAL_TEST_USER_ID?.trim() || 'b0000001'
const TEST_VECTOR_DIM = 8

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function testVector(seed: number): number[] {
  const v = Array.from({ length: TEST_VECTOR_DIM }, () => 0)
  v[seed % TEST_VECTOR_DIM] = 1
  return v
}

async function buildMemoryRowsFromDisk(
  conversationId: string,
): Promise<TurnMemoryRow[]> {
  const rows: TurnMemoryRow[] = []
  let i = 0
  for (const loc of await enumerateAllChunkChains(conversationId)) {
    const chunk = await readChunkFileAt(
      conversationId,
      loc.branchPath,
      loc.chunkFileName,
    )
    if (!chunk?.turns?.length) continue
    for (const turn of filterEmbeddableTurns(chunk.turns)) {
      const corpus = turnEmbeddingCorpus(turn)
      if (!corpus.trim()) continue
      rows.push({
        turnId: turn.turnId,
        turnOrdinal: turn.turnOrdinal,
        branchPath: loc.branchPath,
        chunkFileName: loc.chunkFileName,
        corpus,
        vector: testVector(i++),
      })
    }
  }
  return rows
}

async function countMemorySearchHits(conversationId: string): Promise<number> {
  const hits = await searchTurnMemoryVectors(
    conversationId,
    testVector(0),
    'branch memory integration',
    100,
    new Set(),
  )
  return hits.length
}

async function memoryHitsOnBranchPath(
  conversationId: string,
  branchPath: string,
): Promise<number> {
  const hits = await searchTurnMemoryVectors(
    conversationId,
    testVector(0),
    'branch memory integration',
    100,
    new Set(),
  )
  return hits.filter((h) => h.branchPath === branchPath).length
}

async function seedConversationWithTwoBranches(conversationId: string): Promise<{
  forkTurnId: string
}> {
  await createConversationStub(conversationId, 'delete + lance')
  const first = await saveFirstTurn({
    conversationId,
    userText: 'u0',
    assistantText: 'a0',
  })
  assert.ok(first)

  await appendConversationTurn({
    conversationId,
    userText: 'u1',
    receives: [{ id: '', content: 'a1' }],
    activeReceiveIndex: 0,
  })

  const forkTurn = (await readAllTurns(conversationId))[1]!
  assert.ok(forkTurn.turnId)

  const branch1 = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: forkTurn.turnId,
    label: 'B1',
    setActive: true,
  })
  assert.ok(!('error' in branch1))
  await appendConversationTurn({
    conversationId,
    userText: 'u-b1',
    receives: [{ id: '', content: 'a-b1' }],
    activeReceiveIndex: 0,
  })

  await updateConversationActiveBranchPath(conversationId, '')
  const branch2 = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: forkTurn.turnId,
    label: 'B2',
    setActive: true,
  })
  assert.ok(!('error' in branch2))
  await appendConversationTurn({
    conversationId,
    userText: 'u-b2',
    receives: [{ id: '', content: 'a-b2' }],
    activeReceiveIndex: 0,
  })

  return { forkTurnId: forkTurn.turnId }
}

async function runDeleteBranchIntegration(): Promise<void> {
  const conversationId = generateShortId()
  await seedConversationWithTwoBranches(conversationId)

  assert.deepEqual(await collectRegisteredBranchPaths(conversationId), [
    'branch1',
    'branch2',
  ])

  const deleted = await deleteConversationBranch(conversationId, 'branch2')
  assert.ok(!('error' in deleted))
  assert.equal(deleted.path, 'branch2')
  assert.equal(deleted.activeBranchPath, '')

  assert.deepEqual(await collectRegisteredBranchPaths(conversationId), ['branch1'])
  assert.equal(
    await pathExists(path.join(conversationDir(conversationId), 'branch2')),
    false,
  )

  const idx = await readConversationIndex(conversationId)
  assert.ok(idx)
  assert.equal(idx.activeBranchPath, undefined)

  const onMain = await resolveActivePathTurns(conversationId, '')
  assert.deepEqual(
    onMain.map((t) => getTurnUserText(t)),
    ['u0', 'u1'],
  )

  await updateConversationActiveBranchPath(conversationId, 'branch1')
  const delB1 = await deleteConversationBranch(conversationId, 'branch1')
  assert.ok(!('error' in delB1))
  assert.equal(delB1.activeBranchPath, '')
  assert.deepEqual(await collectRegisteredBranchPaths(conversationId), [])

  console.log('[branch-delete-integration] ok')
}

async function runMemoryLanceIntegration(): Promise<void> {
  const conversationId = generateShortId()
  await seedConversationWithTwoBranches(conversationId)

  const plan = await planConversationMemoryReindex(conversationId)
  const diskRows = await buildMemoryRowsFromDisk(conversationId)
  assert.equal(diskRows.length, plan.turns)
  assert.ok(plan.turns >= 4)

  await replaceTurnMemoryIndex(conversationId, diskRows)
  assert.equal(await countMemorySearchHits(conversationId), plan.turns)
  assert.ok((await memoryHitsOnBranchPath(conversationId, 'branch1')) >= 1)
  assert.ok((await memoryHitsOnBranchPath(conversationId, 'branch2')) >= 1)

  const branch1HitsBefore = await memoryHitsOnBranchPath(conversationId, 'branch1')
  const branch2HitsBefore = await memoryHitsOnBranchPath(conversationId, 'branch2')

  await deleteConversationBranch(conversationId, 'branch2')
  assert.equal(await memoryHitsOnBranchPath(conversationId, 'branch2'), 0)
  assert.equal(
    await memoryHitsOnBranchPath(conversationId, 'branch1'),
    branch1HitsBefore,
  )
  assert.ok(branch2HitsBefore >= 1)

  console.log('[branch-memory-lance-integration] ok')
}

async function maybeRunEmbeddingReindexE2e(): Promise<void> {
  if (process.env.AROUSAL_EMBEDDING_E2E !== '1') {
    console.log('[branch-memory-lance-e2e] skipped (AROUSAL_EMBEDDING_E2E!=1)')
    return
  }

  const apiKey = process.env.AROUSAL_EMBEDDING_API_KEY?.trim()
  const baseUrl = process.env.AROUSAL_EMBEDDING_BASE_URL?.trim()
  const model = process.env.AROUSAL_EMBEDDING_MODEL?.trim()
  if (!apiKey || !baseUrl || !model) {
    console.log('[branch-memory-lance-e2e] skipped (missing embedding env)')
    return
  }

  await updateGlobalEmbeddingApiSettings({
    apiKey,
    baseUrl,
    embeddingModel: model,
  })

  const conversationId = generateShortId()
  await seedConversationWithTwoBranches(conversationId)
  const plan = await planConversationMemoryReindex(conversationId)
  assert.ok(plan.turns >= 4)

  const result = await reindexConversationMemory(conversationId)
  if (!result.ok) {
    console.log(
      `[branch-memory-lance-e2e] skipped (reindex failed: ${result.error})`,
    )
    return
  }

  assert.equal(result.indexed, plan.turns)
  assert.equal(await countMemorySearchHits(conversationId), plan.turns)
  assert.ok((await memoryHitsOnBranchPath(conversationId, 'branch1')) >= 1)
  assert.ok((await memoryHitsOnBranchPath(conversationId, 'branch2')) >= 1)

  console.log('[branch-memory-lance-e2e] ok')
}

async function runNestedDeleteIntegration(): Promise<void> {
  const conversationId = generateShortId()
  await createConversationStub(conversationId, 'nested delete test')

  const first = await saveFirstTurn({
    conversationId,
    userText: 'u0',
    assistantText: 'a0',
  })
  assert.ok(first)

  await appendConversationTurn({
    conversationId,
    userText: 'u1',
    receives: [{ id: '', content: 'a1' }],
    activeReceiveIndex: 0,
  })
  await appendConversationTurn({
    conversationId,
    userText: 'u2',
    receives: [{ id: '', content: 'a2' }],
    activeReceiveIndex: 0,
  })

  const mainFork = (await resolveActivePathTurns(conversationId, ''))[1]!
  const onBranch1 = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: mainFork.turnId,
    label: 'B1',
  })
  assert.ok(!('error' in onBranch1))

  await appendConversationTurn({
    conversationId,
    userText: 'u-b1',
    receives: [{ id: '', content: 'a-b1' }],
    activeReceiveIndex: 0,
  })

  const branch1Merged = await resolveActivePathTurns(conversationId, 'branch1')
  const nestedFork = branch1Merged[branch1Merged.length - 1]!
  const nested = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: nestedFork.turnId,
    label: 'B1 nested',
  })
  assert.ok(!('error' in nested))
  assert.equal(nested.path, 'branch1/branch1')

  assert.deepEqual(await collectRegisteredBranchPaths(conversationId), [
    'branch1',
    'branch1/branch1',
  ])

  const deleted = await deleteConversationBranch(conversationId, 'branch1')
  assert.ok(!('error' in deleted))
  assert.deepEqual(await collectRegisteredBranchPaths(conversationId), [])
  assert.equal(
    await pathExists(path.join(conversationDir(conversationId), 'branch1')),
    false,
  )
  assert.equal(
    await pathExists(path.join(conversationDir(conversationId), 'branch1', 'branch1')),
    false,
  )

  console.log('[branch-nested-delete-integration] ok')
}

async function runNestedDeleteKeepParentIntegration(): Promise<void> {
  const conversationId = generateShortId()
  await createConversationStub(conversationId, 'nested delete keep parent')

  const first = await saveFirstTurn({
    conversationId,
    userText: 'u0',
    assistantText: 'a0',
  })
  assert.ok(first)

  await appendConversationTurn({
    conversationId,
    userText: 'u1',
    receives: [{ id: '', content: 'a1' }],
    activeReceiveIndex: 0,
  })

  const mainFork = (await resolveActivePathTurns(conversationId, ''))[1]!
  const onBranch1 = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: mainFork.turnId,
    label: 'B1',
  })
  assert.ok(!('error' in onBranch1))

  await appendConversationTurn({
    conversationId,
    userText: 'u-b1',
    receives: [{ id: '', content: 'a-b1' }],
    activeReceiveIndex: 0,
  })

  const branch1Merged = await resolveActivePathTurns(conversationId, 'branch1')
  const nestedFork = branch1Merged[branch1Merged.length - 1]!
  const nested = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: nestedFork.turnId,
    label: 'B1 nested',
  })
  assert.ok(!('error' in nested))
  assert.equal(nested.path, 'branch1/branch1')

  const deletedNested = await deleteConversationBranch(conversationId, 'branch1/branch1')
  assert.ok(!('error' in deletedNested))
  assert.deepEqual(await collectRegisteredBranchPaths(conversationId), ['branch1'])
  assert.equal(
    await pathExists(path.join(conversationDir(conversationId), 'branch1')),
    true,
  )
  assert.equal(
    await pathExists(path.join(conversationDir(conversationId), 'branch1', 'branch1')),
    false,
  )

  console.log('[branch-nested-delete-keep-parent-integration] ok')
}

async function main() {
  await runRequestUserAsync(TEST_USER, async () => {
    ensureDataSkeletonForUser(TEST_USER)
    await runDeleteBranchIntegration()
    await runNestedDeleteIntegration()
    await runNestedDeleteKeepParentIntegration()
    await runMemoryLanceIntegration()
    await maybeRunEmbeddingReindexE2e()
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
