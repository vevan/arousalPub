import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractMacroCharacterFields } from '../../../src/prompt-macros/character-fields.js'
import { buildPromptMacroContext } from '../../../src/prompt-macros/context.js'
import { renderPromptMacrosCst } from '../../../src/prompt-macros/cst/render.js'

const sampleCard = {
  name: '艾拉',
  description: '角色描述',
}

function ctx(
  overrides: Parameters<typeof buildPromptMacroContext>[0] &
    Record<string, unknown> = {},
) {
  return buildPromptMacroContext({
    conversationUserName: '小明',
    characters: [
      { name: '艾拉', macroFields: extractMacroCharacterFields(sampleCard) },
    ],
    now: new Date('2026-06-10T15:04:05Z'),
    ...overrides,
  })
}

/** CST 模块专属用例；平铺宏 / Phase A–C 见 prompt-macros.test.ts */
describe('CST parser & blocks', () => {
  it('closes if blocks when inner tags contain nested {{ }}', () => {
    const c = ctx()
    assert.equal(
      renderPromptMacrosCst(
        '{{if user}}A{{setvar::k::{{char}}}}B{{/if}}{{getvar::k}}',
        c,
      ),
      'AB艾拉',
    )
    assert.equal(c.macroLocalVars?.k, '艾拉')
  })

  it('handles nested if with balanced block scan', () => {
    assert.equal(
      renderPromptMacrosCst(
        '{{if user}}{{if char}}Y{{/if}}Z{{/if}}',
        ctx(),
      ),
      'YZ',
    )
  })
})
