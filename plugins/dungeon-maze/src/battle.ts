import {
  createEnemyCombatant,
  findDungeonEnemy,
  type DungeonCatalog,
} from './catalog.js'
import {
  resolveCombatAttack,
  rollInitiative,
  type CombatLogEntry,
  type CombatRandom,
  type Combatant,
  type InitiativeEntry,
} from './combat.js'
import type { DungeonMazeState } from './maze.js'

export const HERO_COMBATANT_ID = 'hero'

export interface DungeonCombatState {
  initiative: InitiativeEntry[]
  currentTurn: number
  combatants: Combatant[]
  log: CombatLogEntry[]
  outcome: 'victory' | 'defeat' | null
}

function createHeroCombatant(catalog: DungeonCatalog): Combatant {
  const weapon = catalog.equipment[0]
  if (!weapon) throw new Error('missing_dungeon_weapon')
  return {
    id: HERO_COMBATANT_ID,
    name: '冒险者',
    hp: 18,
    hpMax: 18,
    ac: 14,
    initiativeMod: 2,
    attackBonus: weapon.attackBonus,
    damage: weapon.damage,
  }
}

function combatantById(combat: DungeonCombatState, id: string): Combatant {
  const combatant = combat.combatants.find((candidate) => candidate.id === id)
  if (!combatant) throw new Error(`unknown_combatant:${id}`)
  return combatant
}

export function beginDungeonCombat(
  state: DungeonMazeState,
  catalog: DungeonCatalog,
  random: CombatRandom = Math.random,
): DungeonMazeState | null {
  if (state.activeCombat || state.activeEvent?.kind !== 'combat') return null
  const entity = state.entities.find((candidate) => candidate.id === state.activeEvent?.entityId)
  if (!entity?.catalogId) throw new Error(`missing_dungeon_enemy:${state.activeEvent.entityId}`)
  const combatants = [createHeroCombatant(catalog), createEnemyCombatant(findDungeonEnemy(catalog, entity.catalogId), entity.id)]
  return {
    ...state,
    activeCombat: {
      initiative: rollInitiative(combatants, random),
      currentTurn: 0,
      combatants,
      log: [],
      outcome: null,
    },
  }
}

export function advanceDungeonCombat(
  state: DungeonMazeState,
  random: CombatRandom = Math.random,
): DungeonMazeState | null {
  const combat = state.activeCombat
  if (!combat || combat.outcome) return null
  const actorId = combat.initiative[combat.currentTurn]?.actorId
  if (!actorId) throw new Error('invalid_dungeon_initiative')
  const targetId = actorId === HERO_COMBATANT_ID
    ? combat.combatants.find((candidate) => candidate.id !== HERO_COMBATANT_ID)?.id
    : HERO_COMBATANT_ID
  if (!targetId) throw new Error('missing_dungeon_combat_target')
  const result = resolveCombatAttack(combatantById(combat, actorId), combatantById(combat, targetId), random)
  const combatants = combat.combatants.map((candidate) => candidate.id === targetId ? result.target : candidate)
  const targetDefeated = result.target.hp === 0
  return {
    ...state,
    activeCombat: {
      ...combat,
      combatants,
      log: [...combat.log, result.log],
      currentTurn: targetDefeated ? combat.currentTurn : (combat.currentTurn + 1) % combat.initiative.length,
      outcome: targetDefeated ? (targetId === HERO_COMBATANT_ID ? 'defeat' : 'victory') : null,
    },
  }
}
