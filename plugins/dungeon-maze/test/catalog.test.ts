import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEnemyCombatant,
  DEFAULT_DUNGEON_CATALOG,
  findDungeonEnemy,
  parseDungeonCatalog,
} from '../src/catalog.ts'

test('loads the bundled catalog and makes enemies into combatants', () => {
  const goblin = findDungeonEnemy(DEFAULT_DUNGEON_CATALOG, 'goblin-skirmisher')
  assert.deepEqual(createEnemyCombatant(goblin, 'minion-1'), {
    id: 'minion-1', name: '哥布林散兵', hp: 7, hpMax: 7, ac: 13,
    initiativeMod: 2, attackBonus: 4, damage: '1d6+2',
  })
})

test('rejects malformed or duplicate catalog entries before they reach combat', () => {
  assert.throws(() => parseDungeonCatalog({
    enemies: { schemaVersion: 1, enemies: [{ id: 'same', name: 'A', role: 'minion', hp: 1, ac: 1, initiativeMod: 0, attacks: [] }] },
    equipment: { schemaVersion: 1, equipment: [{ id: 'same', name: 'Sword', category: 'weapon', damage: 'd8', attackBonus: 1 }] },
  }), /invalid_catalog:enemies\[0\]\.attacks/)
  assert.throws(() => findDungeonEnemy(DEFAULT_DUNGEON_CATALOG, 'missing'), /unknown_dungeon_enemy/)
})

test('accepts negative combat modifiers from low ability scores', () => {
  const catalog = parseDungeonCatalog({
    enemies: { schemaVersion: 1, enemies: [{ id: 'kobold', name: 'Kobold', role: 'minion', hp: 5, ac: 12, initiativeMod: -1, attacks: [{ name: 'Dagger', attackBonus: -1, damage: '1d4-1' }] }] },
    equipment: { schemaVersion: 1, equipment: [{ id: 'club', name: 'Club', category: 'weapon', damage: '1d4-1', attackBonus: -1 }] },
  })
  assert.equal(catalog.enemies[0]?.initiativeMod, -1)
  assert.equal(catalog.equipment[0]?.attackBonus, -1)
})
