import assert from 'node:assert/strict'
import test from 'node:test'
import { createDungeonMaze, findDungeonPath, hasLineOfSight, MAZE_SIZE, moveDungeonHero } from '../src/maze.ts'

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

test('walls block the 5 by 5 field of view but remain visible themselves', () => {
  const cells = Array.from({ length: 5 }, () => Array<number>(5).fill(1))
  cells[2]![2] = 0
  assert.equal(hasLineOfSight(cells, { x: 1, y: 2 }, { x: 2, y: 2 }), true)
  assert.equal(hasLineOfSight(cells, { x: 1, y: 2 }, { x: 3, y: 2 }), false)
})
