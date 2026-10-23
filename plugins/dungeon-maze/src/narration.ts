import type { DungeonCombatState } from './types.js'

export type NarrationTranslator = (key: string, params?: Record<string, unknown>) => string

/** Fixed-format facts; the model never resolves combat or writes game state. */
export function formatCombatReport(combat: DungeonCombatState, t: NarrationTranslator): string {
  if (!combat.outcome) throw new Error('combat_not_finished')
  const name = (id: string) => {
    const actor = combat.combatants.find((candidate) => candidate.id === id)
    if (!actor) throw new Error(`unknown_combatant:${id}`)
    return `${JSON.stringify(actor.name)} [${id}]`
  }
  return [
    `# ${t('reportTitle')}`,
    t('reportOutcome', { outcome: t(combat.outcome === 'victory' ? 'reportVictory' : 'reportDefeat') }),
    `## ${t('reportInitiativeTitle')}`,
    ...combat.initiative.map((entry) => t('reportInitiative', { actor: name(entry.actorId), roll: entry.roll, total: entry.total })),
    `## ${t('reportActionsTitle')}`,
    ...combat.log.map((entry, index) => {
      const damage = entry.rolls.damage
      return t('reportAction', {
        step: index + 1, actor: name(entry.actorId), target: name(entry.targetId),
        roll: entry.rolls.attackD20, total: entry.rolls.attackTotal, ac: entry.targetAc,
        hit: t(entry.hit ? 'reportHit' : 'combatMiss'),
        dice: damage ? t('reportDamageDice', {
          expression: damage.expression, dice: damage.dice.join(', '), modifier: damage.modifier, total: damage.total,
        }) : t('reportNotRolled'),
        damage: entry.damageTotal, hp: entry.hpAfter, effects: JSON.stringify(entry.effectsApplied),
      })
    }),
    `## ${t('reportFinalStateTitle')}`,
    ...combat.combatants.map((actor) => t('reportFinalState', { actor: name(actor.id), hp: actor.hp, hpMax: actor.hpMax, ac: actor.ac })),
  ].join('\n')
}

