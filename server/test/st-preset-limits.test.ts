import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertStPresetWithinLimits,
  ST_PRESET_MAX_PROMPTS,
  StPresetValidationError,
} from '../src/st-preset-limits.js'

describe('assertStPresetWithinLimits', () => {
  it('rejects too many prompts', () => {
    const prompts = Array.from({ length: ST_PRESET_MAX_PROMPTS + 1 }, (_, i) => ({
      identifier: `p${i}`,
    }))
    assert.throws(
      () => assertStPresetWithinLimits({ prompts }),
      StPresetValidationError,
    )
  })
})
