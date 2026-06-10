import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyRegexPersistForTurn,
  hasEnabledPersistRules,
} from './regex-persist.js'
import type { RegexRule } from './regex-rules-types.js'

function rule(partial: Partial<RegexRule> & Pick<RegexRule, 'id'>): RegexRule {
  return {
    label: partial.label ?? partial.id,
    order: partial.order ?? 10,
    enabled: partial.enabled ?? true,
    phases: partial.phases ?? ['persist'],
    fields: partial.fields ?? ['assistant'],
    skipLastNTurns: partial.skipLastNTurns ?? 0,
    pattern: partial.pattern ?? '',
    flags: partial.flags ?? 'g',
    replacement: partial.replacement ?? '',
    ...partial,
  }
}

describe('hasEnabledPersistRules', () => {
  it('detects persist phase rules', () => {
    assert.equal(
      hasEnabledPersistRules([
        rule({ id: '11111111', phases: ['outgoing'], enabled: true }),
      ]),
      false,
    )
    assert.equal(
      hasEnabledPersistRules([
        rule({ id: '11111111', phases: ['persist'], enabled: true }),
      ]),
      true,
    )
  })
})

describe('applyRegexPersistForTurn', () => {
  it('mutates fields before write', () => {
    const rules = [
      rule({
        id: '11111111',
        fields: ['assistant'],
        pattern: 'track',
        replacement: '',
      }),
    ]
    const out = applyRegexPersistForTurn(
      rules,
      {
        userText: 'hello',
        assistantContent: 'reply track',
      },
      3,
    )
    assert.equal(out.assistantContent, 'reply ')
    assert.equal(out.userText, 'hello')
  })
})
