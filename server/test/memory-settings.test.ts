import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeMemorySettings,
  parseMemorySettingsPatch,
} from '../src/memory-settings.js'

describe('parseMemorySettingsPatch', () => {
  it('accepts recall user weight patch', () => {
    const r = parseMemorySettingsPatch({ recallUserWeight: 0.7 }, 'global')
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.patch.recallUserWeight, 0.7)
  })

  it('rejects invalid stripBlockTags', () => {
    const r = parseMemorySettingsPatch({ stripBlockTags: [1] }, 'global')
    assert.equal(r.ok, false)
  })
})

describe('normalizeMemorySettings defaults', () => {
  it('enables strip by default without ex-prefix wildcard', () => {
    const s = normalizeMemorySettings({})
    assert.equal(s.stripPluginBlocks, true)
    assert.equal(s.stripExPrefixElements, false)
    assert.equal(s.recallFuseLastAssistant, true)
    assert.equal(s.recallUserWeight, 0.85)
  })
})
