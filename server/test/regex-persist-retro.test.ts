import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isRetroOrdinalEligible,
  mergeRetroAttemptOrdinals,
  resolveRetroOrdinalsFromRules,
} from '../src/regex-persist-retro.js'
import type { RegexRule } from '../src/regex-rules-types.js'

function rule(partial: Partial<RegexRule> & Pick<RegexRule, 'id'>): RegexRule {
  const skipLastNTurns = partial.skipLastNTurns ?? 0
  return {
    label: partial.label ?? partial.id,
    order: partial.order ?? 10,
    enabled: partial.enabled ?? true,
    phases: partial.phases ?? ['persist'],
    fields: partial.fields ?? ['assistant'],
    skipLastNTurns,
    skipLastNTurnsDisplay: partial.skipLastNTurnsDisplay ?? skipLastNTurns,
    skipLastNTurnsOutgoing: partial.skipLastNTurnsOutgoing ?? skipLastNTurns,
    skipLastNTurnsPersist: partial.skipLastNTurnsPersist ?? skipLastNTurns,
    pattern: partial.pattern ?? '',
    flags: partial.flags ?? 'g',
    replacement: partial.replacement ?? '',
    ...partial,
  }
}

describe('resolveRetroOrdinalsFromRules', () => {
  it('returns distinct T-N for each skip value', () => {
    const rules = [
      rule({ id: '11111111', skipLastNTurns: 3 }),
      rule({ id: '22222222', skipLastNTurns: 5 }),
    ]
    assert.deepEqual(resolveRetroOrdinalsFromRules(rules, 7), [2, 4])
  })

  it('ignores skip zero and non-persist rules', () => {
    const rules = [
      rule({ id: '11111111', skipLastNTurns: 0 }),
      rule({ id: '22222222', phases: ['outgoing'], skipLastNTurns: 3 }),
    ]
    assert.deepEqual(resolveRetroOrdinalsFromRules(rules, 7), [])
  })
})

describe('isRetroOrdinalEligible', () => {
  const rules = [rule({ id: '11111111', skipLastNTurns: 3 })]

  it('allows ordinal at skip boundary', () => {
    assert.equal(isRetroOrdinalEligible(4, 7, rules), true)
  })

  it('rejects ordinal still inside skip window', () => {
    assert.equal(isRetroOrdinalEligible(5, 7, rules), false)
  })
})

describe('mergeRetroAttemptOrdinals', () => {
  it('dedupes pending and rule ordinals', () => {
    assert.deepEqual(
      mergeRetroAttemptOrdinals([2, 4], [4, 6]),
      [2, 4, 6],
    )
  })
})
