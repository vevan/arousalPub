import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPromptMacroContext } from './context.js'
import {
  evaluateVariableShorthand,
  parseVariableShorthand,
} from './macro-shorthand-op.js'

describe('macro-shorthand-op', () => {
  it('parses operators', () => {
    assert.deepEqual(parseVariableShorthand('.score += 10'), {
      scope: 'local',
      name: 'score',
      op: '+=',
      value: '10',
    })
    assert.deepEqual(parseVariableShorthand('.counter++'), {
      scope: 'local',
      name: 'counter',
      op: '++',
    })
    assert.deepEqual(parseVariableShorthand('$tier = a'), {
      scope: 'global',
      name: 'tier',
      op: '=',
      value: 'a',
    })
  })

  it('evaluates set, +=, ++, and comparison strings', () => {
    const c = buildPromptMacroContext({
      conversationUserName: 'u',
      characters: [{ name: 'c' }],
      macroLocalVars: { score: '5', status: 'active' },
    })
    assert.equal(evaluateVariableShorthand('.score = 9', c), '')
    assert.equal(c.macroLocalVars?.score, '9')
    assert.equal(evaluateVariableShorthand('.score += 10', c), '')
    assert.equal(c.macroLocalVars?.score, '19')
    assert.equal(evaluateVariableShorthand('.n++', c), '1')
    assert.equal(c.macroLocalVars?.n, '1')
    assert.equal(evaluateVariableShorthand('.status == active', c), 'true')
    assert.equal(evaluateVariableShorthand('.status == off', c), 'false')
  })

  it('supports ?? and ||', () => {
    const c = buildPromptMacroContext({
      conversationUserName: 'u',
      characters: [{ name: 'c' }],
      macroLocalVars: { empty: '', zero: '0', name: 'Ada' },
    })
    assert.equal(evaluateVariableShorthand('.missing ?? Guest', c), 'Guest')
    assert.equal(evaluateVariableShorthand('.zero ?? Guest', c), '0')
    assert.equal(evaluateVariableShorthand('.empty || Anonymous', c), 'Anonymous')
    assert.equal(evaluateVariableShorthand('.name || Anonymous', c), 'Ada')
  })
})
