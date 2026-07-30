import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateStCondition } from '../../src/prompt-macros/macro-condition.js'
import {
  parseComparisonExpression,
  unwrapConditionBraces,
} from '../../src/prompt-macros/macro-expr.js'
import { buildPromptMacroContext } from '../../src/prompt-macros/context.js'
import { applyPromptMacroPipeline } from '../../src/prompt-macros/pipeline.js'

describe('macro-expr', () => {
  it('unwraps condition braces', () => {
    assert.equal(unwrapConditionBraces('{{.x == y}}'), '.x == y')
  })

  it('parses == and !=', () => {
    assert.deepEqual(parseComparisonExpression('.a == High'), {
      op: '==',
      left: '.a',
      right: 'High',
    })
    assert.deepEqual(parseComparisonExpression('.a != Low'), {
      op: '!=',
      left: '.a',
      right: 'Low',
    })
  })

  it('evaluates comparison in if conditions', () => {
    const c = buildPromptMacroContext({
      conversationUserName: 'u',
      characters: [{ name: 'c' }],
      macroLocalVars: { effort: 'High' },
    })
    assert.equal(
      evaluateStCondition('{{.effort == High}}', c),
      true,
    )
    assert.equal(
      evaluateStCondition('{{.effort == Low}}', c),
      false,
    )
    const c2 = buildPromptMacroContext({
      conversationUserName: 'u',
      characters: [{ name: 'c' }],
      macroLocalVars: { thoughtscope: '1' },
    })
    assert.equal(evaluateStCondition('.thoughtscope == "1"', c2), true)
  })

  it('evaluates nested getvar defaults and literal 0 as falsy', () => {
    const c = buildPromptMacroContext({
      conversationUserName: 'u',
      characters: [{ name: 'c' }],
      macroLocalVars: { flag: '0' },
    })
    const render = (s: string) => applyPromptMacroPipeline(s, c)
    assert.equal(evaluateStCondition('{{getvar::flag::1}}', c, render), false)
    assert.equal(evaluateStCondition('0', c, render), false)
    assert.equal(evaluateStCondition('user', c, render), true)
  })
})
