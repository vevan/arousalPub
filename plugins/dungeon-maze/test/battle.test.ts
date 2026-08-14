import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceDungeonCombat, beginDungeonCombat, HERO_COMBATANT_ID } from '../src/battle.ts'
import { DEFAULT_DUNGEON_CATALOG } from '../src/catalog.ts'
import { completeDungeonCombat, createDungeonMaze, createDungeonMapEvent } from '../src/maze.ts'

function randomSequence(values: number[]): () => number {
  let index = 0
  return () => values[index++] ?? 0
}

test('creates a catalog-backed combat loop and resolves the map event only after victory', () => {
  const maze = createDungeonMaze(12345)
  const enemy = maze.entities.find((entity) => entity.kind === 'minion')!
  const encounter = { ...maze, activeEvent: createDungeonMapEvent(enemy) }
  const started = beginDungeonCombat(encounter, DEFAULT_DUNGEON_CATALOG, randomSequence([0.99, 0]))
  assert.equal(started?.activeCombat?.initiative[0]?.actorId, HERO_COMBATANT_ID)
  const hit = started && advanceDungeonCombat(started, randomSequence([0.99, 0.99]))
  assert.equal(hit?.activeCombat?.log[0]?.damageTotal, 10)
  assert.equal(hit?.activeCombat?.outcome, 'victory')
  const complete = hit && completeDungeonCombat(hit)
  assert.equal(complete?.activeEvent, null)
  assert.equal(complete?.activeCombat, null)
  assert.ok(complete?.resolvedEntityIds.includes(enemy.id))
})

test('clears the combat encounter on defeat without resolving the enemy', () => {
  const maze = createDungeonMaze(12345)
  const enemy = maze.entities.find((entity) => entity.kind === 'minion')!
  const event = createDungeonMapEvent(enemy)
  const complete = completeDungeonCombat({
    ...maze,
    activeEvent: event,
    activeCombat: {
      initiative: [],
      currentTurn: 0,
      combatants: [],
      log: [],
      outcome: 'defeat',
    },
  })
  assert.equal(complete?.activeEvent, null)
  assert.equal(complete?.activeCombat, null)
  assert.equal(complete?.resolvedEntityIds.includes(enemy.id), false)
  assert.equal(complete?.elapsedMinutes, maze.elapsedMinutes + event.minutes)
})
