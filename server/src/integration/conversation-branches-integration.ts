/**
 * 分支 API 集成脚本 — 须在独立进程运行，且设置 DATA_DIR 指向空临时目录。
 * 由 conversation-branches.integration.test.ts 调用。
 */
import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { generateShortId } from '../short-id.js'
import { ensureDataSkeletonForUser } from '../config.js'
import { runRequestUserAsync } from '../user-context.js'
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
  readChunkFileAt,
  resolveActivePathTurns,
} from '../chunk-chain.js'
import {
  createEmptyConversationBranch,
  getConversationBranchTree,
  updateConversationActiveBranchPath,
} from '../conversation-branches.js'
import { loadConversationMessages } from '../conversation-messages-api.js'
import {
  loadTurnsForMemoryPipeline,
  runMemoryPipeline,
} from '../memory-pipeline.js'
import { HISTORY_SETTINGS_DEFAULTS } from '../history-settings.js'
import { MEMORY_SETTINGS_DEFAULTS } from '../memory-settings.js'
import { buildAllowedBranchPathsForActive } from '../chunk-path.js'
import {
  replaceTurnMemoryIndex,
  searchTurnMemoryVectors,
  type TurnMemoryRow,
} from '../memory-store.js'
import { turnEmbeddingCorpus } from '../turn-memory-xml.js'

const TEST_USER = process.env.AROUSAL_TEST_USER_ID?.trim() || 'b0000001'

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const TEST_VECTOR_DIM = 8

function testQueryVector(): number[] {
  const v = Array.from({ length: TEST_VECTOR_DIM }, () => 0)
  v[0] = 1
  return v
}

async function buildMemoryRowsFromDisk(
  conversationId: string,
): Promise<TurnMemoryRow[]> {
  const vector = testQueryVector()
  const rows: TurnMemoryRow[] = []
  for (const loc of await enumerateAllChunkChains(conversationId)) {
    const chunk = await readChunkFileAt(
      conversationId,
      loc.branchPath,
      loc.chunkFileName,
    )
    if (!chunk?.turns?.length) continue
    for (const turn of chunk.turns) {
      const corpus = turnEmbeddingCorpus(turn)
      if (!corpus.trim()) continue
      rows.push({
        turnId: turn.turnId,
        turnOrdinal: turn.turnOrdinal,
        branchPath: loc.branchPath,
        chunkFileName: loc.chunkFileName,
        corpus,
        vector,
      })
    }
  }
  return rows
}

async function assertMemoryExcludesSiblingBranches(
  conversationId: string,
  activePath: string,
  excludedPaths: string[],
  mustInclude?: { turnId: string; branchPath: string },
): Promise<void> {
  const memoryRows = await buildMemoryRowsFromDisk(conversationId)
  await replaceTurnMemoryIndex(conversationId, memoryRows)

  const excludedTurnIds = new Set(
    memoryRows
      .filter((r) => excludedPaths.includes(r.branchPath))
      .map((r) => r.turnId),
  )
  for (const p of excludedPaths) {
    assert.ok(memoryRows.some((r) => r.branchPath === p), `expected rows on ${p}`)
  }

  const allowed = buildAllowedBranchPathsForActive(activePath)
  const hits = await searchTurnMemoryVectors(
    conversationId,
    testQueryVector(),
    'branch recall query',
    30,
    new Set(),
    undefined,
    allowed,
  )

  for (const hit of hits) {
    for (const p of excludedPaths) {
      assert.notEqual(hit.branchPath, p)
    }
    assert.ok(!excludedTurnIds.has(hit.turnId))
  }
  if (mustInclude) {
    assert.ok(
      hits.some(
        (h) => h.turnId === mustInclude.turnId && h.branchPath === mustInclude.branchPath,
      ),
      `expected hit on ${mustInclude.branchPath}`,
    )
  }
}

async function runRecallIntegration(
  conversationId: string,
  forkTurn: { turnId: string },
  branch1TailTurn: { turnId: string },
): Promise<void> {
  await updateConversationActiveBranchPath(conversationId, '')

  const branch2Created = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: forkTurn.turnId,
    label: '分支 2',
    setActive: false,
  })
  assert.ok(!('error' in branch2Created))
  assert.equal(branch2Created.path, 'branch2')

  await updateConversationActiveBranchPath(conversationId, 'branch2')
  await appendConversationTurn({
    conversationId,
    userText: 'u-branch2',
    receives: [{ id: '', content: 'a-branch2' }],
    activeReceiveIndex: 0,
  })

  await updateConversationActiveBranchPath(conversationId, 'branch1')

  const messages = await loadConversationMessages(conversationId, { tail: '10' })
  assert.ok(messages.ok)
  assert.equal(messages.response.turns.length, 3)
  assert.deepEqual(
    messages.response.turns.map((t) => t.user),
    ['u0', 'u1', 'u-branch'],
  )

  const pipelineTurns = await loadTurnsForMemoryPipeline(
    conversationId,
    16,
    undefined,
    'branch1',
  )
  assert.deepEqual(
    pipelineTurns.map((t) => getTurnUserText(t)),
    ['u0', 'u1', 'u-branch'],
  )

  const pipeline = await runMemoryPipeline({
    conversationId,
    userText: 'recall query',
    memorySettings: { ...MEMORY_SETTINGS_DEFAULTS, memoryEnabled: false },
    historySettings: HISTORY_SETTINGS_DEFAULTS,
    activeBranchPath: 'branch1',
  })
  assert.deepEqual(
    pipeline.recentTurns.map((t) => getTurnUserText(t)),
    ['u0', 'u1', 'u-branch'],
  )

  const memoryRows = await buildMemoryRowsFromDisk(conversationId)
  assert.ok(memoryRows.some((r) => r.branchPath === 'branch2'))
  assert.ok(memoryRows.some((r) => r.branchPath === 'branch1'))

  await assertMemoryExcludesSiblingBranches(
    conversationId,
    'branch1',
    ['branch2'],
    { turnId: branch1TailTurn.turnId, branchPath: 'branch1' },
  )

  // eslint-disable-next-line no-console
  console.log('[branch-recall-integration] ok')
}

/** 验收：主路径 activeBranchPath="" 与分支无关，messages 仅含主线 turn */
async function runMainPathRegressionAcceptance(conversationId: string): Promise<void> {
  await updateConversationActiveBranchPath(conversationId, '')
  const idx = await readConversationIndex(conversationId)
  assert.ok(idx)
  assert.equal(idx.activeBranchPath, undefined)

  const merged = await resolveActivePathTurns(conversationId, '')
  assert.equal(merged.length, 3)
  assert.deepEqual(
    merged.map((t) => t.send.userText),
    ['u0', 'u1', 'u2'],
  )

  const messages = await loadConversationMessages(conversationId, { tail: '10' })
  assert.ok(messages.ok)
  assert.equal(messages.response.turns.length, 3)
  assert.deepEqual(
    messages.response.turns.map((t) => t.user),
    ['u0', 'u1', 'u2'],
  )

  const mainChains = (await enumerateAllChunkChains(conversationId)).filter(
    (l) => l.branchPath === '',
  )
  assert.ok(mainChains.length >= 1)
  assert.ok(mainChains.every((l) => !l.chunkFileName.includes('/')))

  // eslint-disable-next-line no-console
  console.log('[branch-accept-main-path] ok')
}

/**
 * 验收：fork @160 → 空 branch1/；首条分支消息 ordinal 161 写入 turn-000100-000199.json
 */
async function runForkAt160Acceptance(): Promise<void> {
  const conversationId = generateShortId()
  await createConversationStub(conversationId, 'fork at 160')
  const first = await saveFirstTurn({
    conversationId,
    userText: 'u0',
    assistantText: 'a0',
  })
  assert.ok(first)

  for (let i = 1; i <= 160; i++) {
    const ok = await appendConversationTurn({
      conversationId,
      userText: `u${i}`,
      receives: [{ id: '', content: `a${i}` }],
      activeReceiveIndex: 0,
      branchPath: '',
    })
    assert.ok(ok, `append main turn ${i}`)
  }

  const mainTurns = await resolveActivePathTurns(conversationId, '')
  assert.equal(mainTurns.length, 161)
  const forkTurn = mainTurns[160]!
  assert.equal(forkTurn.turnOrdinal, 160)

  const created = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: forkTurn.turnId,
    setActive: true,
  })
  assert.ok(!('error' in created))
  assert.equal(created.forkOrdinal, 160)

  const branchDir = path.join(conversationDir(conversationId), 'branch1')
  const branchDirFiles = await readdir(branchDir)
  assert.deepEqual(branchDirFiles.sort(), ['index.json'])

  await appendConversationTurn({
    conversationId,
    userText: 'u-branch-first',
    receives: [{ id: '', content: 'a-branch-first' }],
    activeReceiveIndex: 0,
  })

  const branchFiles = await readdir(branchDir)
  assert.ok(branchFiles.includes('turn-000100-000199.json'))
  assert.equal(
    branchFiles.filter((f) => f.startsWith('turn-') && f.endsWith('.json')).length,
    1,
  )

  const branchChunk = await readChunkFileAt(
    conversationId,
    'branch1',
    'turn-000100-000199.json',
  )
  assert.ok(branchChunk)
  assert.equal(branchChunk.turns.length, 1)
  assert.equal(branchChunk.turns[0]!.turnOrdinal, 161)
  assert.equal(branchChunk.turns[0]!.send.userText, 'u-branch-first')

  const activeMerged = await resolveActivePathTurns(conversationId, 'branch1')
  assert.equal(activeMerged.length, 162)
  assert.equal(activeMerged[161]!.turnOrdinal, 161)

  // eslint-disable-next-line no-console
  console.log('[branch-accept-fork-160] ok')
}

/**
 * 多层子树：branch1 → branch1/branch1 与 branch1/branch2（同级嵌套兄弟）。
 */
async function runNestedBranchIntegration(): Promise<void> {
  const conversationId = generateShortId()
  await createConversationStub(conversationId, 'nested branch test')

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
    label: 'L1 分支 1',
  })
  assert.ok(!('error' in onBranch1))
  assert.equal(onBranch1.path, 'branch1')

  await appendConversationTurn({
    conversationId,
    userText: 'u-b1-a',
    receives: [{ id: '', content: 'a-b1-a' }],
    activeReceiveIndex: 0,
  })
  await appendConversationTurn({
    conversationId,
    userText: 'u-b1-b',
    receives: [{ id: '', content: 'a-b1-b' }],
    activeReceiveIndex: 0,
  })

  const branch1Merged = await resolveActivePathTurns(conversationId, 'branch1')
  assert.deepEqual(
    branch1Merged.map((t) => getTurnUserText(t)),
    ['u0', 'u1', 'u-b1-a', 'u-b1-b'],
  )
  const nestedFork = branch1Merged[3]!

  const nested1 = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: nestedFork.turnId,
    label: 'L2 嵌套 1',
  })
  assert.ok(!('error' in nested1))
  assert.equal(nested1.path, 'branch1/branch1')
  assert.equal(nested1.activeBranchPath, 'branch1/branch1')

  await appendConversationTurn({
    conversationId,
    userText: 'u-n1-a',
    receives: [{ id: '', content: 'a-n1-a' }],
    activeReceiveIndex: 0,
  })

  await updateConversationActiveBranchPath(conversationId, 'branch1')
  const nested2 = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: nestedFork.turnId,
    label: 'L2 嵌套 2',
    setActive: false,
  })
  assert.ok(!('error' in nested2))
  assert.equal(nested2.path, 'branch1/branch2')

  await updateConversationActiveBranchPath(conversationId, 'branch1/branch2')
  await appendConversationTurn({
    conversationId,
    userText: 'u-n2-a',
    receives: [{ id: '', content: 'a-n2-a' }],
    activeReceiveIndex: 0,
  })

  await updateConversationActiveBranchPath(conversationId, 'branch1/branch1')

  const nestedMerged = await resolveActivePathTurns(conversationId, 'branch1/branch1')
  assert.deepEqual(
    nestedMerged.map((t) => getTurnUserText(t)),
    ['u0', 'u1', 'u-b1-a', 'u-b1-b', 'u-n1-a'],
  )

  const nested2Merged = await resolveActivePathTurns(conversationId, 'branch1/branch2')
  assert.deepEqual(
    nested2Merged.map((t) => getTurnUserText(t)),
    ['u0', 'u1', 'u-b1-a', 'u-b1-b', 'u-n2-a'],
  )

  const registered = await collectRegisteredBranchPaths(conversationId)
  assert.deepEqual(registered.sort(), ['branch1', 'branch1/branch1', 'branch1/branch2'])

  const branch1Idx = JSON.parse(
    await readFile(path.join(conversationDir(conversationId), 'branch1', 'index.json'), 'utf8'),
  ) as { branches?: { path?: string }[] }
  assert.equal(branch1Idx.branches?.length, 2)
  const relPaths = (branch1Idx.branches ?? [])
    .map((b) => b.path)
    .filter(Boolean)
    .sort()
  assert.deepEqual(relPaths, ['branch1', 'branch2'])

  assert.ok(await pathExists(path.join(conversationDir(conversationId), 'branch1', 'branch1', 'index.json')))
  assert.ok(await pathExists(path.join(conversationDir(conversationId), 'branch1', 'branch2', 'index.json')))

  const tree = await getConversationBranchTree(conversationId)
  assert.ok(!('error' in tree))
  assert.equal(tree.activeBranchPath, 'branch1/branch1')
  const l1 = tree.nodes[0]!.children.find((n) => n.path === 'branch1')
  assert.ok(l1)
  assert.equal(l1.children.length, 2)
  assert.deepEqual(
    l1.children.map((n) => n.path).sort(),
    ['branch1/branch1', 'branch1/branch2'],
  )
  assert.equal(l1.children.find((n) => n.path === 'branch1/branch1')?.turnCount, 1)
  assert.equal(l1.children.find((n) => n.path === 'branch1/branch2')?.turnCount, 1)

  const messages = await loadConversationMessages(conversationId, { tail: '10' })
  assert.ok(messages.ok)
  assert.deepEqual(
    messages.response.turns.map((t) => t.user),
    ['u0', 'u1', 'u-b1-a', 'u-b1-b', 'u-n1-a'],
  )

  const pipeline = await runMemoryPipeline({
    conversationId,
    userText: 'nested recall',
    memorySettings: { ...MEMORY_SETTINGS_DEFAULTS, memoryEnabled: false },
    historySettings: HISTORY_SETTINGS_DEFAULTS,
    activeBranchPath: 'branch1/branch1',
  })
  assert.deepEqual(
    pipeline.recentTurns.map((t) => getTurnUserText(t)),
    ['u0', 'u1', 'u-b1-a', 'u-b1-b', 'u-n1-a'],
  )

  const n1Tail = nestedMerged[4]!
  await assertMemoryExcludesSiblingBranches(
    conversationId,
    'branch1/branch1',
    ['branch1/branch2'],
    { turnId: n1Tail.turnId, branchPath: 'branch1/branch1' },
  )

  // 根级 branch2 不在祖先链，也应被排除（若存在则来自其它会话污染 — 本 conv 无）
  const allowedNested = buildAllowedBranchPathsForActive('branch1/branch1')
  assert.deepEqual([...allowedNested].sort(), ['', 'branch1', 'branch1/branch1'])

  // eslint-disable-next-line no-console
  console.log('[branch-nested-integration] ok')
}

/**
 * 复杂交叉：三层嵌套 + 各层兄弟 + 根级 branch2 与深链并存；active 切换与 memory 隔离。
 *
 * ```text
 * "" ─ u0,u1,u2
 * ├── branch1 (fork@1) ─ u-b1, u-b1-fork
 * │   ├── branch1/branch1 ─ u-L2a, u-L2a-fork
 * │   │   └── branch1/branch1/branch1 ─ u-L3
 * │   └── branch1/branch2 ─ u-L2b
 * └── branch2 (fork@2) ─ u-r2
 * ```
 */
async function runCrossBranchIntegration(): Promise<void> {
  const conversationId = generateShortId()
  await createConversationStub(conversationId, 'cross branch test')

  assert.ok(
    await saveFirstTurn({
      conversationId,
      userText: 'u0',
      assistantText: 'a0',
    }),
  )
  for (const [user, assistant] of [
    ['u1', 'a1'],
    ['u2', 'a2'],
  ] as const) {
    await appendConversationTurn({
      conversationId,
      userText: user,
      receives: [{ id: '', content: assistant }],
      activeReceiveIndex: 0,
    })
  }

  const mainTurns = await resolveActivePathTurns(conversationId, '')
  assert.equal(mainTurns.length, 3)
  const mainFork1 = mainTurns[1]!
  const mainFork2 = mainTurns[2]!

  assert.ok(
    !('error' in
      (await createEmptyConversationBranch({
        conversationId,
        forkTurnId: mainFork1.turnId,
        label: 'L1',
      }))),
  )

  await appendConversationTurn({
    conversationId,
    userText: 'u-b1',
    receives: [{ id: '', content: 'a-b1' }],
    activeReceiveIndex: 0,
  })
  await appendConversationTurn({
    conversationId,
    userText: 'u-b1-fork',
    receives: [{ id: '', content: 'a-b1-fork' }],
    activeReceiveIndex: 0,
  })

  const l1Fork = (await resolveActivePathTurns(conversationId, 'branch1')).slice(-1)[0]!

  assert.ok(
    !('error' in
      (await createEmptyConversationBranch({
        conversationId,
        forkTurnId: l1Fork.turnId,
        label: 'L2a',
      }))),
  )
  assert.equal(
    (await readConversationIndex(conversationId))?.activeBranchPath,
    'branch1/branch1',
  )

  await appendConversationTurn({
    conversationId,
    userText: 'u-L2a',
    receives: [{ id: '', content: 'a-L2a' }],
    activeReceiveIndex: 0,
  })
  await appendConversationTurn({
    conversationId,
    userText: 'u-L2a-fork',
    receives: [{ id: '', content: 'a-L2a-fork' }],
    activeReceiveIndex: 0,
  })

  const l2Fork = (await resolveActivePathTurns(conversationId, 'branch1/branch1')).slice(-1)[0]!

  assert.ok(
    !('error' in
      (await createEmptyConversationBranch({
        conversationId,
        forkTurnId: l2Fork.turnId,
        label: 'L3',
      }))),
  )
  assert.equal(
    (await readConversationIndex(conversationId))?.activeBranchPath,
    'branch1/branch1/branch1',
  )

  await appendConversationTurn({
    conversationId,
    userText: 'u-L3',
    receives: [{ id: '', content: 'a-L3' }],
    activeReceiveIndex: 0,
  })

  await updateConversationActiveBranchPath(conversationId, 'branch1')
  assert.ok(
    !('error' in
      (await createEmptyConversationBranch({
        conversationId,
        forkTurnId: l1Fork.turnId,
        label: 'L2b',
        setActive: false,
      }))),
  )

  await updateConversationActiveBranchPath(conversationId, 'branch1/branch2')
  await appendConversationTurn({
    conversationId,
    userText: 'u-L2b',
    receives: [{ id: '', content: 'a-L2b' }],
    activeReceiveIndex: 0,
  })

  await updateConversationActiveBranchPath(conversationId, '')
  const rootB2 = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: mainFork2.turnId,
    label: 'root-b2',
    setActive: false,
  })
  assert.ok(!('error' in rootB2))
  assert.equal(rootB2.path, 'branch2')

  await updateConversationActiveBranchPath(conversationId, 'branch2')
  await appendConversationTurn({
    conversationId,
    userText: 'u-r2',
    receives: [{ id: '', content: 'a-r2' }],
    activeReceiveIndex: 0,
  })

  const registered = await collectRegisteredBranchPaths(conversationId)
  assert.deepEqual(registered.sort(), [
    'branch1',
    'branch1/branch1',
    'branch1/branch1/branch1',
    'branch1/branch2',
    'branch2',
  ])

  assert.ok(
    await pathExists(
      path.join(
        conversationDir(conversationId),
        'branch1',
        'branch1',
        'branch1',
        'index.json',
      ),
    ),
  )

  const l3Path = 'branch1/branch1/branch1'
  await updateConversationActiveBranchPath(conversationId, l3Path)

  const l3Merged = await resolveActivePathTurns(conversationId, l3Path)
  assert.deepEqual(
    l3Merged.map((t) => getTurnUserText(t)),
    ['u0', 'u1', 'u-b1', 'u-b1-fork', 'u-L2a', 'u-L2a-fork', 'u-L3'],
  )

  const forkMainOnDeep = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: mainFork2.turnId,
  })
  assert.ok('error' in forkMainOnDeep)
  assert.equal(forkMainOnDeep.error, 'fork_turn_not_on_active_path')

  const forkSiblingL2 = await createEmptyConversationBranch({
    conversationId,
    forkTurnId: (await resolveActivePathTurns(conversationId, 'branch1/branch2')).slice(-1)[0]!
      .turnId,
  })
  assert.ok('error' in forkSiblingL2)
  assert.equal(forkSiblingL2.error, 'fork_turn_not_on_active_path')

  await updateConversationActiveBranchPath(conversationId, 'branch1/branch2')
  assert.deepEqual(
    (await resolveActivePathTurns(conversationId, 'branch1/branch2')).map((t) =>
      getTurnUserText(t),
    ),
    ['u0', 'u1', 'u-b1', 'u-b1-fork', 'u-L2b'],
  )

  await updateConversationActiveBranchPath(conversationId, 'branch2')
  assert.deepEqual(
    (await resolveActivePathTurns(conversationId, 'branch2')).map((t) => getTurnUserText(t)),
    ['u0', 'u1', 'u2', 'u-r2'],
  )

  await updateConversationActiveBranchPath(conversationId, '')
  assert.deepEqual(
    (await resolveActivePathTurns(conversationId, '')).map((t) => getTurnUserText(t)),
    ['u0', 'u1', 'u2'],
  )

  await updateConversationActiveBranchPath(conversationId, l3Path)
  const l3Messages = await loadConversationMessages(conversationId, { tail: '20' })
  assert.ok(l3Messages.ok)
  assert.deepEqual(l3Messages.response.turns.map((t) => t.user), l3Merged.map((t) => getTurnUserText(t)))

  const tree = await getConversationBranchTree(conversationId)
  assert.ok(!('error' in tree))
  assert.equal(tree.activeBranchPath, l3Path)

  const rootBranch1 = tree.nodes[0]!.children.find((n) => n.path === 'branch1')
  const rootBranch2 = tree.nodes[0]!.children.find((n) => n.path === 'branch2')
  assert.ok(rootBranch1 && rootBranch2)
  assert.equal(rootBranch1.children.length, 2)
  const l2a = rootBranch1.children.find((n) => n.path === 'branch1/branch1')
  assert.ok(l2a)
  assert.equal(l2a.children.length, 1)
  assert.equal(l2a.children[0]!.path, l3Path)
  assert.equal(l2a.children[0]!.turnCount, 1)
  assert.equal(rootBranch2!.turnCount, 1)

  assert.deepEqual([...buildAllowedBranchPathsForActive(l3Path)].sort(), [
    '',
    'branch1',
    'branch1/branch1',
    'branch1/branch1/branch1',
  ])

  const l3Tail = l3Merged.slice(-1)[0]!
  await assertMemoryExcludesSiblingBranches(
    conversationId,
    l3Path,
    ['branch1/branch2', 'branch2'],
    { turnId: l3Tail.turnId, branchPath: l3Path },
  )

  await updateConversationActiveBranchPath(conversationId, 'branch2')
  await assertMemoryExcludesSiblingBranches(conversationId, 'branch2', ['branch1', 'branch1/branch1/branch1'])

  // eslint-disable-next-line no-console
  console.log('[branch-cross-integration] ok')
}

async function runIntegration(): Promise<void> {
  ensureDataSkeletonForUser(TEST_USER)

  const conversationId = generateShortId()
  await createConversationStub(conversationId, 'branch test')
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

    const mainTurns = await resolveActivePathTurns(conversationId, '')
    assert.equal(mainTurns.length, 3)
    const forkTurn = mainTurns[1]!
    assert.equal(forkTurn.turnOrdinal, 1)

    const created = await createEmptyConversationBranch({
      conversationId,
      forkTurnId: forkTurn.turnId,
      label: '分支 1',
      forkMessageId: forkTurn.receives[0]?.id,
    })
    assert.ok(!('error' in created))
    assert.equal(created.path, 'branch1')
    assert.equal(created.forkOrdinal, 1)
    assert.equal(created.activeBranchPath, 'branch1')

    const rootIdx = await readConversationIndex(conversationId)
    assert.ok(rootIdx)
    assert.equal(rootIdx.activeBranchPath, 'branch1')
    assert.ok(Array.isArray(rootIdx.branches))
    assert.equal(rootIdx.branches!.length, 1)
    const reg = rootIdx.branches![0] as {
      forkTurnId?: string
      path?: string
      label?: string
    }
    assert.equal(reg.forkTurnId, forkTurn.turnId)
    assert.equal(reg.path, 'branch1')
    assert.equal(reg.label, '分支 1')

    const branchIdxPath = path.join(conversationDir(conversationId), 'branch1', 'index.json')
    assert.ok(await pathExists(branchIdxPath))
    const branchIdx = JSON.parse(await readFile(branchIdxPath, 'utf8')) as {
      headChunkFile: string | null
      tailChunkFile: string | null
    }
    assert.equal(branchIdx.headChunkFile, null)
    assert.equal(branchIdx.tailChunkFile, null)

    const branchDirFiles = await readdir(path.join(conversationDir(conversationId), 'branch1'))
    assert.deepEqual(branchDirFiles.sort(), ['index.json'])

    const tailFile = rootIdx.tailChunkFile
    assert.ok(tailFile)
    const forkChunk = await readChunkFileAt(conversationId, '', tailFile)
    assert.ok(forkChunk)
    const linkBranches = forkChunk.meta.links.branches as { path?: string }[]
    assert.ok(Array.isArray(linkBranches) && linkBranches.length >= 1)
    assert.equal(linkBranches.some((b) => b.path === 'branch1'), true)

    const registered = await collectRegisteredBranchPaths(conversationId)
    assert.deepEqual(registered, ['branch1'])

    const activeBeforeAppend = await resolveActivePathTurns(conversationId, 'branch1')
    assert.deepEqual(
      activeBeforeAppend.map((t) => t.turnOrdinal),
      [0, 1],
    )

    await appendConversationTurn({
      conversationId,
      userText: 'u-branch',
      receives: [{ id: '', content: 'a-branch' }],
      activeReceiveIndex: 0,
    })

    const afterAppend = await resolveActivePathTurns(conversationId, 'branch1')
    assert.deepEqual(
      afterAppend.map((t) => t.turnOrdinal),
      [0, 1, 2],
    )
    assert.equal(afterAppend[2]!.send.userText, 'u-branch')

    const branchFilesAfter = await readdir(path.join(conversationDir(conversationId), 'branch1'))
    assert.ok(branchFilesAfter.some((f) => f.startsWith('turn-') && f.endsWith('.json')))

    const tree = await getConversationBranchTree(conversationId)
    assert.ok(!('error' in tree))
    assert.equal(tree.activeBranchPath, 'branch1')
    assert.equal(tree.nodes.length, 1)
    assert.equal(tree.nodes[0]!.path, '')
    assert.equal(tree.nodes[0]!.children.length, 1)
    assert.equal(tree.nodes[0]!.children[0]!.path, 'branch1')
    assert.equal(tree.nodes[0]!.children[0]!.turnCount, 1)
    assert.equal(tree.nodes[0]!.children[0]!.forkOrdinal, 1)

    const notOnActive = await createEmptyConversationBranch({
      conversationId,
      forkTurnId: mainTurns[2]!.turnId,
    })
    assert.ok('error' in notOnActive)
    assert.equal(notOnActive.error, 'fork_turn_not_on_active_path')

    const switched = await updateConversationActiveBranchPath(conversationId, '')
    assert.ok(!('error' in switched))
    assert.equal(switched.activeBranchPath, undefined)

    await runMainPathRegressionAcceptance(conversationId)

    const conv2 = generateShortId()
    await createConversationStub(conv2, 'setActive false')
    await saveFirstTurn({
      conversationId: conv2,
      userText: 'only',
      assistantText: 'one',
    })
    const onlyTurn = (await resolveActivePathTurns(conv2, ''))[0]!
    const noSetActive = await createEmptyConversationBranch({
      conversationId: conv2,
      forkTurnId: onlyTurn.turnId,
      setActive: false,
    })
    assert.ok(!('error' in noSetActive))
    const conv2Idx = await readConversationIndex(conv2)
    assert.ok(conv2Idx)
    assert.equal(conv2Idx.activeBranchPath, undefined)

    await runRecallIntegration(conversationId, forkTurn, afterAppend[2]!)

    await runForkAt160Acceptance()

    await runNestedBranchIntegration()

    await runCrossBranchIntegration()

  // eslint-disable-next-line no-console
  console.log('[branch-integration] ok')
}

function main(): Promise<void> {
  return runRequestUserAsync(TEST_USER, runIntegration)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
