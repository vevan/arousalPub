export type CombatRandom = () => number

export interface DiceRoll {
  expression: string
  dice: number[]
  modifier: number
  total: number
}

export interface Combatant {
  id: string
  name: string
  hp: number
  hpMax: number
  ac: number
  initiativeMod: number
  attackBonus: number
  damage: string
}

export interface InitiativeEntry {
  actorId: string
  roll: number
  total: number
}

export interface CombatLogEntry {
  actorId: string
  targetId: string
  action: 'attack'
  rolls: {
    attackD20: number
    attackTotal: number
    damage?: DiceRoll
  }
  targetAc: number
  hit: boolean
  damageTotal: number
  hpAfter: number
  effectsApplied: string[]
}

export interface CombatAttackResult {
  target: Combatant
  log: CombatLogEntry
}

type ParsedDiceExpression = {
  count: number
  sides: number
  modifier: number
}

const DICE_EXPRESSION = /^(\d+)d(\d+)([+-]\d+)?$/i

function parseDiceExpression(expression: string): ParsedDiceExpression {
  const match = DICE_EXPRESSION.exec(expression.trim())
  if (!match) throw new Error(`invalid_dice_expression:${expression}`)
  const count = Number(match[1])
  const sides = Number(match[2])
  const modifier = Number(match[3] ?? 0)
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(sides) || count < 1 || sides < 2) {
    throw new Error(`invalid_dice_expression:${expression}`)
  }
  return { count, sides, modifier }
}

function rollDie(sides: number, random: CombatRandom): number {
  const value = random()
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('combat_random_out_of_range')
  return Math.floor(value * sides) + 1
}

export function rollDice(expression: string, random: CombatRandom = Math.random): DiceRoll {
  const parsed = parseDiceExpression(expression)
  const dice = Array.from({ length: parsed.count }, () => rollDie(parsed.sides, random))
  const total = dice.reduce((sum, die) => sum + die, parsed.modifier)
  return { expression, dice, modifier: parsed.modifier, total }
}

export function rollInitiative(
  combatants: readonly Combatant[],
  random: CombatRandom = Math.random,
): InitiativeEntry[] {
  return combatants
    .map((combatant) => {
      const roll = rollDie(20, random)
      return { actorId: combatant.id, roll, total: roll + combatant.initiativeMod }
    })
    .sort((a, b) => b.total - a.total || b.roll - a.roll || a.actorId.localeCompare(b.actorId))
}

export function resolveCombatAttack(
  actor: Combatant,
  target: Combatant,
  random: CombatRandom = Math.random,
): CombatAttackResult {
  const attackD20 = rollDie(20, random)
  const attackTotal = attackD20 + actor.attackBonus
  const hit = attackTotal >= target.ac
  const damage = hit ? rollDice(actor.damage, random) : undefined
  const damageTotal = Math.max(0, damage?.total ?? 0)
  const nextHp = Math.max(0, target.hp - damageTotal)
  return {
    target: { ...target, hp: nextHp },
    log: {
      actorId: actor.id,
      targetId: target.id,
      action: 'attack',
      rolls: { attackD20, attackTotal, ...(damage ? { damage } : {}) },
      targetAc: target.ac,
      hit,
      damageTotal,
      hpAfter: nextHp,
      effectsApplied: [],
    },
  }
}
