import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyRegexRulesToText } from './regex-apply.js'
import {
  buildDefaultRegexRulesDocument,
  DEFAULT_ELLIPSIS_PATTERN,
  DEFAULT_REGEX_SEED_RULE_ID,
} from './regex-rules-default-seed.js'
import { normalizeRegexRulesDocument } from './regex-rules-file.js'

describe('buildDefaultRegexRulesDocument', () => {
  it('seeds ellipsis normalization rule', () => {
    const doc = normalizeRegexRulesDocument(buildDefaultRegexRulesDocument())
    assert.equal(doc.rules.length, 1)
    const rule = doc.rules[0]
    assert.equal(rule?.id, DEFAULT_REGEX_SEED_RULE_ID)
    assert.equal(rule?.label, '规范省略号')
    assert.deepEqual(rule?.phases, ['display'])
    assert.deepEqual(rule?.fields, ['user', 'assistant', 'system'])
    assert.equal(rule?.skipLastNTurns, 0)
    assert.equal(rule?.pattern, DEFAULT_ELLIPSIS_PATTERN)
    assert.equal(rule?.replacement, '…')
    assert.equal(rule?.enabled, false)
  })

  it('normalizes dot and ideographic period ellipsis', () => {
    const doc = buildDefaultRegexRulesDocument()
    const rule = { ...doc.rules[0]!, enabled: true }
    const apply = (text: string) =>
      applyRegexRulesToText(text, [rule], {
        phase: 'display',
        field: 'assistant',
        turnOrdinal: 0,
        tailOrdinal: 0,
      })
    assert.equal(apply('她说。。。就走了'), '她说…就走了')
    assert.equal(apply('等等...再说'), '等等…再说')
    assert.equal(apply('混合。。...'), '混合……')
  })
})
