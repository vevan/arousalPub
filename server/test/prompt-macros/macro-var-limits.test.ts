import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clampMacroVarValue,
  MACRO_VAR_MAX_KEYS,
  MACRO_VAR_MAX_VALUE_LENGTH,
  sanitizeMacroVarMap,
} from '../../src/prompt-macros/macro-var-limits.js'

describe('macro-var-limits', () => {
  it('truncates oversized values', () => {
    const long = 'x'.repeat(MACRO_VAR_MAX_VALUE_LENGTH + 10)
    assert.equal(clampMacroVarValue(long).length, MACRO_VAR_MAX_VALUE_LENGTH)
  })

  it('caps key count on sanitize', () => {
    const raw: Record<string, string> = {}
    for (let i = 0; i < MACRO_VAR_MAX_KEYS + 5; i++) {
      raw[`k${i}`] = 'v'
    }
    assert.equal(Object.keys(sanitizeMacroVarMap(raw)).length, MACRO_VAR_MAX_KEYS)
  })
})
