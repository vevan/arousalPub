import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveCombatAttack,
  rollDice,
  rollInitiative,
  type CombatRandom,
  type Combatant,
} from '../src/combat.ts'

function randomSequence(values: number[]): CombatRandom {
  let index = 0
  return () => values[index++] ?? 0
}

const hero: Combatant = {
  id: 'hero',
  name: 'Hero',
  hp: 12,
  hpMax: 12,
  ac: 14,
  initiativeMod: 2,
  attackBonus: 4,
  damage: '1d6+2',
}

const goblin: Combatant = {
  id: 'goblin-1',
  name: 'Goblin',
  hp: 7,
  hpMax: 7,
  ac: 13,
  initiativeMod: 2,
  attackBonus: 4,
  damage: '1d6+2',
}

test('rolls supported dice expressions deterministically', () => {
  assert.deepEqual(rollDice('2d6-1', randomSequence([0, 0.999])), {
    expression: '2d6-1',
    dice: [1, 6],
    modifier: -1,
    total: 6,
  })
  assert.throws(() => rollDice('d6', randomSequence([])), /invalid_dice_expression/)
  assert.throws(() => rollDice('1d1', randomSequence([])), /invalid_dice_expression/)
})

test('orders initiative by total, raw die, then actor id', () => {
  assert.deepEqual(rollInitiative([hero, goblin], randomSequence([0.4, 0.4])), [
    { actorId: 'goblin-1', roll: 9, total: 11 },
    { actorId: 'hero', roll: 9, total: 11 },
  ])
})

test('records a hit with rolled damage and clamps target hp', () => {
  const result = resolveCombatAttack(hero, goblin, randomSequence([0.7, 0.999]))
  assert.equal(result.target.hp, 0)
  assert.deepEqual(result.log, {
    actorId: 'hero',
    targetId: 'goblin-1',
    action: 'attack',
    rolls: {
      attackD20: 15,
      attackTotal: 19,
      damage: { expression: '1d6+2', dice: [6], modifier: 2, total: 8 },
    },
    targetAc: 13,
    hit: true,
    damageTotal: 8,
    hpAfter: 0,
    effectsApplied: [],
  })
})

test('records a miss without rolling damage', () => {
  const result = resolveCombatAttack(hero, goblin, randomSequence([0]))
  assert.equal(result.target.hp, 7)
  assert.deepEqual(result.log.rolls, { attackD20: 1, attackTotal: 5 })
  assert.equal(result.log.hit, false)
  assert.equal(result.log.damageTotal, 0)
})
