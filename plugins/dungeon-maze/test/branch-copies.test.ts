import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DUNGEON_STATES_KEY,
  flushDungeonMazeBranchCopies,
  type BranchCopyEvent,
  type PendingMazeState,
} from '../src/branch-copies.ts'
import { createDungeonMaze } from '../src/maze.ts'

function event(
  conversationId: string,
  parentBranchPath: string,
  branchPath: string,
): BranchCopyEvent {
  return { conversationId, parentBranchPath, branchPath }
}

test('flush discards when parent has no maze and does not requeue', async () => {
  const queue = [event('c1', '', 'branch-1')]
  const patches: Record<string, unknown>[] = []
  const failed = await flushDungeonMazeBranchCopies({
    queue,
    pendingState: null,
    getConversationId: () => 'c1',
    getPluginSettings: async () => ({}),
    patchPluginSettings: async (partial) => {
      patches.push(partial)
      return partial
    },
  })
  assert.equal(failed, false)
  assert.deepEqual(queue, [])
  assert.deepEqual(patches, [])
})

test('flush discards when child branch already has state', async () => {
  const root = createDungeonMaze(12345)
  const child = createDungeonMaze(99999)
  const queue = [event('c1', '', 'branch-1')]
  const patches: Record<string, unknown>[] = []
  const failed = await flushDungeonMazeBranchCopies({
    queue,
    pendingState: null,
    getConversationId: () => 'c1',
    getPluginSettings: async () => ({
      [DUNGEON_STATES_KEY]: { '': root, 'branch-1': child },
    }),
    patchPluginSettings: async (partial) => {
      patches.push(partial)
      return partial
    },
  })
  assert.equal(failed, false)
  assert.deepEqual(queue, [])
  assert.deepEqual(patches, [])
})

test('flush copies parent maze into new branch settings', async () => {
  const root = createDungeonMaze(12345)
  const queue = [event('c1', '', 'branch-1')]
  let stored: Record<string, unknown> = { [DUNGEON_STATES_KEY]: { '': root } }
  const failed = await flushDungeonMazeBranchCopies({
    queue,
    pendingState: null,
    getConversationId: () => 'c1',
    getPluginSettings: async () => stored,
    patchPluginSettings: async (partial) => {
      stored = { ...stored, ...partial }
      return stored
    },
  })
  assert.equal(failed, false)
  assert.deepEqual(queue, [])
  const states = stored[DUNGEON_STATES_KEY] as Record<string, { seed: number; hero: { x: number; y: number } }>
  assert.equal(states['branch-1']?.seed, root.seed)
  assert.deepEqual(states['branch-1']?.hero, root.hero)
  assert.notEqual(states['branch-1'], root)
})

test('flush merges pending parent state before snapshot', async () => {
  const pendingRoot = createDungeonMaze(4242)
  const queue = [event('c1', '', 'branch-1')]
  let stored: Record<string, unknown> = {}
  const pendingState: PendingMazeState = {
    conversationId: 'c1',
    branchPath: '',
    state: pendingRoot,
  }
  const failed = await flushDungeonMazeBranchCopies({
    queue,
    pendingState,
    getConversationId: () => 'c1',
    getPluginSettings: async () => stored,
    patchPluginSettings: async (partial) => {
      stored = { ...stored, ...partial }
      return stored
    },
  })
  assert.equal(failed, false)
  assert.deepEqual(queue, [])
  const states = stored[DUNGEON_STATES_KEY] as Record<string, { seed: number }>
  assert.equal(states['']?.seed, pendingRoot.seed)
  assert.equal(states['branch-1']?.seed, pendingRoot.seed)
})

test('flush requeues on patch failure', async () => {
  const root = createDungeonMaze(12345)
  const due = event('c1', '', 'branch-1')
  const other = event('c2', '', 'other-branch')
  const queue = [due, other]
  const failed = await flushDungeonMazeBranchCopies({
    queue,
    pendingState: null,
    getConversationId: () => 'c1',
    getPluginSettings: async () => ({ [DUNGEON_STATES_KEY]: { '': root } }),
    patchPluginSettings: async () => {
      throw new Error('write failed')
    },
  })
  assert.equal(failed, true)
  assert.deepEqual(queue, [due, other])
})

test('flush requeues when conversation switches mid-read', async () => {
  const root = createDungeonMaze(12345)
  const due = event('c1', '', 'branch-1')
  const queue = [due]
  let conversationId = 'c1'
  const patches: Record<string, unknown>[] = []
  const failed = await flushDungeonMazeBranchCopies({
    queue,
    pendingState: null,
    getConversationId: () => conversationId,
    getPluginSettings: async () => {
      conversationId = 'c2'
      return { [DUNGEON_STATES_KEY]: { '': root } }
    },
    patchPluginSettings: async (partial) => {
      patches.push(partial)
      return partial
    },
  })
  assert.equal(failed, false)
  assert.deepEqual(queue, [due])
  assert.deepEqual(patches, [])
})

test('flush leaves other-conversation events in queue while discarding no-op local events', async () => {
  const other = event('c2', '', 'remote-branch')
  const queue = [event('c1', '', 'branch-1'), other]
  const failed = await flushDungeonMazeBranchCopies({
    queue,
    pendingState: null,
    getConversationId: () => 'c1',
    getPluginSettings: async () => ({}),
    patchPluginSettings: async () => {
      throw new Error('should not patch')
    },
  })
  assert.equal(failed, false)
  assert.deepEqual(queue, [other])
})

test('flush copies one parent and discards a sibling no-op in the same batch', async () => {
  const root = createDungeonMaze(12345)
  const existingChild = createDungeonMaze(7)
  const queue = [
    event('c1', '', 'branch-new'),
    event('c1', '', 'branch-existing'),
  ]
  let stored: Record<string, unknown> = {
    [DUNGEON_STATES_KEY]: { '': root, 'branch-existing': existingChild },
  }
  const failed = await flushDungeonMazeBranchCopies({
    queue,
    pendingState: null,
    getConversationId: () => 'c1',
    getPluginSettings: async () => stored,
    patchPluginSettings: async (partial) => {
      stored = { ...stored, ...partial }
      return stored
    },
  })
  assert.equal(failed, false)
  assert.deepEqual(queue, [])
  const states = stored[DUNGEON_STATES_KEY] as Record<string, { seed: number }>
  assert.equal(states['branch-new']?.seed, root.seed)
  assert.equal(states['branch-existing']?.seed, existingChild.seed)
})
