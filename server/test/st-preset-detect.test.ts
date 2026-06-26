import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  detectPromptImportKind,
  formatFilenameAsPresetName,
  isStOpenAiPreset,
} from '../src/st-preset-detect.js'

describe('st-preset-detect', () => {
  it('detects ST preset by prompts + prompt_order', () => {
    const st = {
      prompts: [{ identifier: 'main' }, { identifier: 'pre-a' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main' }] }],
    }
    assert.equal(isStOpenAiPreset(st), true)
    assert.equal(detectPromptImportKind(st), 'st')
  })

  it('prefers native over ST when both shapes match', () => {
    const hybrid = {
      id: 'p1',
      groups: [],
      prompts: [],
      prompt_order: [{ order: [{ identifier: 'x' }] }],
    }
    assert.equal(detectPromptImportKind(hybrid), 'native')
  })

  it('formats filename as preset name', () => {
    assert.equal(
      formatFilenameAsPresetName('Stabs-GLM5.1-Directives-v3.0.1.json'),
      'Stabs GLM5.1 Directives v3.0.1',
    )
  })
})
