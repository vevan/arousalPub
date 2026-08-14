import enemiesSource from '../catalog/enemies.json'
import equipmentSource from '../catalog/equipment.json'
import type { Combatant } from './combat.js'

export type EnemyRole = 'minion' | 'elite' | 'boss'

export interface DungeonAttackDefinition {
  name: string
  attackBonus: number
  damage: string
}

export interface DungeonEnemyDefinition {
  id: string
  name: string
  role: EnemyRole
  hp: number
  ac: number
  initiativeMod: number
  attacks: DungeonAttackDefinition[]
}

export interface DungeonEquipmentDefinition {
  id: string
  name: string
  category: 'weapon'
  damage: string
  attackBonus: number
}

export interface DungeonCatalog {
  schemaVersion: 1
  enemies: DungeonEnemyDefinition[]
  equipment: DungeonEquipmentDefinition[]
}

type CatalogSources = { enemies: unknown; equipment: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validDiceExpression(value: unknown): value is string {
  return typeof value === 'string' && /^\d+d\d+(?:[+-]\d+)?$/i.test(value)
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`invalid_catalog:${path}`)
  return value
}

function requireInteger(value: unknown, path: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`invalid_catalog:${path}`)
  return value as number
}

function requireUniqueIds(entries: readonly { id: string }[], path: string): void {
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error(`invalid_catalog:${path}.id`)
}

export function parseDungeonCatalog(sources: CatalogSources): DungeonCatalog {
  if (!isRecord(sources.enemies) || sources.enemies.schemaVersion !== 1 || !Array.isArray(sources.enemies.enemies)) {
    throw new Error('invalid_catalog:enemies')
  }
  if (!isRecord(sources.equipment) || sources.equipment.schemaVersion !== 1 || !Array.isArray(sources.equipment.equipment)) {
    throw new Error('invalid_catalog:equipment')
  }
  const enemies = sources.enemies.enemies.map((value, index): DungeonEnemyDefinition => {
    if (!isRecord(value) || !Array.isArray(value.attacks)) throw new Error(`invalid_catalog:enemies[${index}]`)
    const role = value.role
    if (role !== 'minion' && role !== 'elite' && role !== 'boss') throw new Error(`invalid_catalog:enemies[${index}].role`)
    const attacks = value.attacks.map((attack, attackIndex): DungeonAttackDefinition => {
      if (!isRecord(attack) || !validDiceExpression(attack.damage)) throw new Error(`invalid_catalog:enemies[${index}].attacks[${attackIndex}]`)
      return {
        name: requireString(attack.name, `enemies[${index}].attacks[${attackIndex}].name`),
        attackBonus: requireInteger(attack.attackBonus, `enemies[${index}].attacks[${attackIndex}].attackBonus`),
        damage: attack.damage,
      }
    })
    if (attacks.length === 0) throw new Error(`invalid_catalog:enemies[${index}].attacks`)
    return {
      id: requireString(value.id, `enemies[${index}].id`),
      name: requireString(value.name, `enemies[${index}].name`),
      role,
      hp: requireInteger(value.hp, `enemies[${index}].hp`, 1),
      ac: requireInteger(value.ac, `enemies[${index}].ac`, 1),
      initiativeMod: requireInteger(value.initiativeMod, `enemies[${index}].initiativeMod`),
      attacks,
    }
  })
  const equipment = sources.equipment.equipment.map((value, index): DungeonEquipmentDefinition => {
    if (!isRecord(value) || value.category !== 'weapon' || !validDiceExpression(value.damage)) {
      throw new Error(`invalid_catalog:equipment[${index}]`)
    }
    return {
      id: requireString(value.id, `equipment[${index}].id`),
      name: requireString(value.name, `equipment[${index}].name`),
      category: 'weapon',
      damage: value.damage,
      attackBonus: requireInteger(value.attackBonus, `equipment[${index}].attackBonus`),
    }
  })
  requireUniqueIds(enemies, 'enemies')
  requireUniqueIds(equipment, 'equipment')
  return { schemaVersion: 1, enemies, equipment }
}

export const DEFAULT_DUNGEON_CATALOG = parseDungeonCatalog({
  enemies: enemiesSource,
  equipment: equipmentSource,
})

export function createEnemyCombatant(
  definition: DungeonEnemyDefinition,
  instanceId: string,
): Combatant {
  const attack = definition.attacks[0]!
  return {
    id: instanceId,
    name: definition.name,
    hp: definition.hp,
    hpMax: definition.hp,
    ac: definition.ac,
    initiativeMod: definition.initiativeMod,
    attackBonus: attack.attackBonus,
    damage: attack.damage,
  }
}

export function findDungeonEnemy(catalog: DungeonCatalog, enemyId: string): DungeonEnemyDefinition {
  const enemy = catalog.enemies.find((candidate) => candidate.id === enemyId)
  if (!enemy) throw new Error(`unknown_dungeon_enemy:${enemyId}`)
  return enemy
}
