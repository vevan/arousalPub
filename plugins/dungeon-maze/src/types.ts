import type {
  CombatLogEntry,
  Combatant,
  InitiativeEntry,
} from './combat.js'

/** 战斗状态（下沉到 types.ts 打断 battle ↔ maze 的 type-only import 环） */
export interface DungeonCombatState {
  initiative: InitiativeEntry[]
  currentTurn: number
  combatants: Combatant[]
  log: CombatLogEntry[]
  outcome: 'victory' | 'defeat' | null
}
