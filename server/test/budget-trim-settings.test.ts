import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BUDGET_TRIM_SETTINGS_DEFAULTS,
  isValidTrimOrder,
  normalizeBudgetTrimSettings,
  parseBudgetTrimSettingsPatch,
  resolveBudgetTrimSettings,
} from '../src/budget-trim-settings.js'

describe('normalizeBudgetTrimSettings', () => {
  it('uses defaults for empty input', () => {
    const s = normalizeBudgetTrimSettings(null)
    assert.deepEqual(s.trimOrder, ['knowledge', 'lore', 'memory', 'history'])
    assert.deepEqual(s.minRetain, {
      knowledge: 1,
      lore: 1,
      memory: 1,
      history: 1,
    })
  })

  it('clamps minRetain', () => {
    const s = normalizeBudgetTrimSettings({
      minRetain: { knowledge: -3, lore: -1, memory: 99, history: 2 },
    })
    assert.equal(s.minRetain.knowledge, 0)
    assert.equal(s.minRetain.lore, 0)
    assert.equal(s.minRetain.memory, 32)
    assert.equal(s.minRetain.history, 2)
  })
})

describe('isValidTrimOrder', () => {
  it('accepts 4-slot permutations', () => {
    assert.equal(
      isValidTrimOrder(['memory', 'knowledge', 'lore', 'history']),
      true,
    )
  })

  it('accepts legacy 3-slot permutations', () => {
    assert.equal(isValidTrimOrder(['memory', 'lore', 'history']), true)
  })

  it('rejects duplicates', () => {
    assert.equal(isValidTrimOrder(['lore', 'lore', 'history']), false)
  })
})

describe('resolveBudgetTrimSettings', () => {
  it('merges conversation override with global', () => {
    const global = BUDGET_TRIM_SETTINGS_DEFAULTS
    const effective = resolveBudgetTrimSettings(global, {
      minRetain: { memory: 2 },
    })
    assert.equal(effective.minRetain.memory, 2)
    assert.equal(effective.minRetain.lore, 1)
    assert.equal(effective.minRetain.knowledge, 1)
  })
})

describe('parseBudgetTrimSettingsPatch', () => {
  it('parses 4-slot trimOrder patch', () => {
    const r = parseBudgetTrimSettingsPatch({
      trimOrder: ['history', 'memory', 'lore', 'knowledge'],
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.deepEqual(r.patch.trimOrder, [
        'history',
        'memory',
        'lore',
        'knowledge',
      ])
    }
  })

  it('legacy 3-slot trimOrder auto-prepends knowledge', () => {
    const r = parseBudgetTrimSettingsPatch({
      trimOrder: ['history', 'memory', 'lore'],
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.deepEqual(r.patch.trimOrder, [
        'knowledge',
        'history',
        'memory',
        'lore',
      ])
    }
  })
})
