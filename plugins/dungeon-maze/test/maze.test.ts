import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDungeonMapEvent,
  createDungeonMaze,
  findDungeonPath,
  hasLineOfSight,
  MAZE_SIZE,
  moveDungeonHero,
  resolveDungeonMapEvent,
  setDungeonCampRestMinutes,
  snapshotDungeonMazeBranch,
} from '../src/maze.ts'

test('creates a deterministic 21 by 21 maze with required entities', () => {
  const maze = createDungeonMaze(12345)
  assert.equal(maze.width, MAZE_SIZE)
  assert.equal(maze.height, MAZE_SIZE)
  assert.deepEqual(maze, createDungeonMaze(12345))
  assert.equal(maze.cells[maze.entrance.y]?.[maze.entrance.x], 1)
  assert.equal(maze.cells[maze.exit.y]?.[maze.exit.x], 1)
  assert.equal(maze.entities.filter((entity) => entity.kind === 'boss').length, 1)
  assert.equal(maze.entities.filter((entity) => entity.kind === 'minion').length, 9)
  assert.ok(maze.entities.filter((entity) => entity.kind === 'chest').length < 9)
  assert.ok(maze.entities.filter((entity) => entity.kind === 'trap').length < 9)
  assert.equal(maze.entities.filter((entity) => entity.kind === 'camp').length, 3)
})

test('moves only to adjacent paths and permanently reveals the surrounding 5 by 5 area', () => {
  const maze = createDungeonMaze(12345)
  const candidates = [
    { x: maze.hero.x + 1, y: maze.hero.y },
    { x: maze.hero.x - 1, y: maze.hero.y },
    { x: maze.hero.x, y: maze.hero.y + 1 },
    { x: maze.hero.x, y: maze.hero.y - 1 },
  ]
  const destination = candidates.find((point) => maze.cells[point.y]?.[point.x] === 1)
  assert.ok(destination)
  const moved = moveDungeonHero(maze, destination)
  assert.ok(moved)
  assert.deepEqual(moved.hero, destination)
  assert.equal(moved.elapsedMinutes, 1)
  assert.equal(moved.explored[destination.y]?.[destination.x], true)
  const revealedX = Math.max(0, Math.min(maze.width - 1, moved.hero.x + 2))
  const revealedY = Math.max(0, Math.min(maze.height - 1, moved.hero.y + 2))
  assert.equal(moved.explored[revealedY]?.[revealedX], true)
  assert.equal(moveDungeonHero(maze, { x: maze.hero.x + 2, y: maze.hero.y }), null)
})

test('finds a route only through explored paths', () => {
  const maze = createDungeonMaze(12345)
  const destination = [
    { x: maze.hero.x + 1, y: maze.hero.y },
    { x: maze.hero.x - 1, y: maze.hero.y },
    { x: maze.hero.x, y: maze.hero.y + 1 },
    { x: maze.hero.x, y: maze.hero.y - 1 },
  ].find((point) => maze.cells[point.y]?.[point.x] === 1)
  assert.ok(destination)
  const moved = moveDungeonHero(maze, destination)
  assert.ok(moved)
  assert.deepEqual(findDungeonPath(moved, maze.hero), [maze.hero])
  assert.equal(findDungeonPath(moved, { x: 0, y: 0 }), null)
})

test('freezes a new branch at creation and keeps later parent changes isolated', () => {
  const root = createDungeonMaze(12345)
  const rootStates = snapshotDungeonMazeBranch({ '': root }, '', 'branch-1')
  const branch = rootStates['branch-1']
  assert.ok(branch)
  assert.notEqual(branch, root)
  const destination = [
    { x: branch.hero.x + 1, y: branch.hero.y },
    { x: branch.hero.x - 1, y: branch.hero.y },
    { x: branch.hero.x, y: branch.hero.y + 1 },
    { x: branch.hero.x, y: branch.hero.y - 1 },
  ].find((point) => branch.cells[point.y]?.[point.x] === 1)
  assert.ok(destination)
  const moved = moveDungeonHero(branch, destination)
  assert.ok(moved)
  const parentMoved = moveDungeonHero(root, destination)
  assert.ok(parentMoved)
  assert.deepEqual(rootStates['branch-1']?.hero, branch.entrance)
  const nestedStates = snapshotDungeonMazeBranch(
    { ...rootStates, 'branch-1': moved },
    'branch-1',
    'branch-1/branch-2',
  )
  assert.deepEqual(nestedStates['branch-1/branch-2']?.hero, moved.hero)
})

test('walls block the 5 by 5 field of view but remain visible themselves', () => {
  const cells = Array.from({ length: 5 }, () => Array<number>(5).fill(1))
  cells[2]![2] = 0
  assert.equal(hasLineOfSight(cells, { x: 1, y: 2 }, { x: 2, y: 2 }), true)
  assert.equal(hasLineOfSight(cells, { x: 1, y: 2 }, { x: 3, y: 2 }), false)
})

test('map objects create persistent combat, check, and camp events with their declared time costs', () => {
  const maze = createDungeonMaze(12345)
  const destination = [
    { x: maze.hero.x + 1, y: maze.hero.y },
    { x: maze.hero.x - 1, y: maze.hero.y },
    { x: maze.hero.x, y: maze.hero.y + 1 },
    { x: maze.hero.x, y: maze.hero.y - 1 },
  ].find((point) => maze.cells[point.y]?.[point.x] === 1)
  assert.ok(destination)
  const withChest = { ...maze, entities: [{ id: 'chest-1', kind: 'chest' as const, ...destination }] }
  const arrived = moveDungeonHero(withChest, destination)
  assert.ok(arrived?.activeEvent)
  assert.equal(arrived.activeEvent.optional, true)
  const skipped = resolveDungeonMapEvent(arrived, 'skip')
  assert.equal(skipped?.elapsedMinutes, 1)
  assert.deepEqual(skipped?.resolvedEntityIds, [])
  const combat = createDungeonMapEvent({ id: 'minion-1', kind: 'minion', catalogId: 'goblin-skirmisher', x: 1, y: 1 })
  const boss = createDungeonMapEvent({ id: 'boss-1', kind: 'boss', catalogId: 'maze-dragon', x: 1, y: 1 })
  const camp = createDungeonMapEvent({ id: 'camp-1', kind: 'camp', x: 1, y: 1 })
  assert.deepEqual(combat, { entityId: 'minion-1', kind: 'combat', optional: false, rounds: 6, minutes: 3 })
  assert.deepEqual(boss, { entityId: 'boss-1', kind: 'combat', optional: false, rounds: 10, minutes: 5 })
  assert.deepEqual(camp, { entityId: 'camp-1', kind: 'camp', optional: true, minutes: 30 })
  const campState = { ...maze, activeEvent: camp }
  const longerRest = setDungeonCampRestMinutes(campState, 90)
  assert.equal(longerRest?.activeEvent?.minutes, 90)
  const rested = longerRest && resolveDungeonMapEvent(longerRest, 'resolve')
  assert.equal(rested?.elapsedMinutes, 90)
  assert.equal(rested?.restedMinutes, 90)
  assert.deepEqual(rested?.resolvedEntityIds, [])
})
