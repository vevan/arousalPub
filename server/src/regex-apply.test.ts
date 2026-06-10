import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyRegexPersistToTurnFields,
  applyRegexRulesToText,
  shouldApplyRegexRule,
  sortRegexRules,
} from './regex-apply.js'
import { replaceRegexWithTimeout } from './regex-exec-timeout.js'
import type { RegexRule } from './regex-rules-types.js'

function rule(partial: Partial<RegexRule> & Pick<RegexRule, 'id'>): RegexRule {
  return {
    label: partial.label ?? partial.id,
    order: partial.order ?? 10,
    enabled: partial.enabled ?? true,
    phases: partial.phases ?? ['outgoing', 'persist'],
    fields: partial.fields ?? ['assistant'],
    skipLastNTurns: partial.skipLastNTurns ?? 0,
    pattern: partial.pattern ?? '',
    flags: partial.flags ?? 'g',
    replacement: partial.replacement ?? '',
    ...partial,
  }
}

describe('sortRegexRules', () => {
  it('sorts by order asc then id', () => {
    const sorted = sortRegexRules([
      rule({ id: 'bbbbbbbb', order: 20 }),
      rule({ id: 'aaaaaaaa', order: 10 }),
      rule({ id: 'cccccccc', order: 10 }),
    ])
    assert.deepEqual(
      sorted.map((r) => r.id),
      ['aaaaaaaa', 'cccccccc', 'bbbbbbbb'],
    )
  })
})

describe('shouldApplyRegexRule', () => {
  const tracker = rule({
    id: '11111111',
    phases: ['outgoing', 'persist'],
    fields: ['assistant'],
    skipLastNTurns: 3,
    pattern: 'x',
  })

  it('skips disabled rules', () => {
    assert.equal(
      shouldApplyRegexRule(
        { ...tracker, enabled: false },
        { phase: 'outgoing', field: 'assistant', turnOrdinal: 1, tailOrdinal: 10 },
      ),
      false,
    )
  })

  it('applies skipLastNTurns to recent turns only', () => {
    const ctx = {
      phase: 'outgoing' as const,
      field: 'assistant' as const,
      tailOrdinal: 10,
    }
    assert.equal(
      shouldApplyRegexRule(tracker, { ...ctx, turnOrdinal: 10 }),
      false,
    )
    assert.equal(
      shouldApplyRegexRule(tracker, { ...ctx, turnOrdinal: 8 }),
      false,
    )
    assert.equal(
      shouldApplyRegexRule(tracker, { ...ctx, turnOrdinal: 7 }),
      true,
    )
  })

  it('ignores skipLastNTurns when turnOrdinal missing (system)', () => {
    assert.equal(
      shouldApplyRegexRule(
        { ...tracker, fields: ['system'], skipLastNTurns: 3 },
        { phase: 'outgoing', field: 'system', tailOrdinal: 10 },
      ),
      true,
    )
  })
})

describe('applyRegexRulesToText', () => {
  it('chains rules by order in memory', () => {
    const rules = [
      rule({
        id: '11111111',
        order: 20,
        phases: ['display'],
        pattern: 'b',
        replacement: 'B',
      }),
      rule({
        id: '22222222',
        order: 10,
        phases: ['display'],
        pattern: 'a',
        replacement: 'A',
      }),
    ]
    const out = applyRegexRulesToText('aba', rules, {
      phase: 'display',
      field: 'assistant',
      turnOrdinal: 1,
      tailOrdinal: 5,
    })
    assert.equal(out, 'ABA')
  })

  it('skips invalid runtime regexp without throwing', () => {
    const rules = [
      rule({
        id: '11111111',
        phases: ['display'],
        pattern: '[',
        flags: '',
        replacement: '!',
      }),
      rule({
        id: '22222222',
        order: 20,
        phases: ['display'],
        pattern: 'ok',
        replacement: 'OK',
      }),
    ]
    const out = applyRegexRulesToText('ok', rules, {
      phase: 'display',
      field: 'assistant',
      tailOrdinal: 1,
    })
    assert.equal(out, 'OK')
  })

  it('respects phase and field filters via shouldApply', () => {
    const rules = [
      rule({
        id: '11111111',
        phases: ['persist'],
        fields: ['user'],
        pattern: 'hi',
        replacement: 'bye',
      }),
    ]
    const out = applyRegexRulesToText('hi', rules, {
      phase: 'display',
      field: 'assistant',
      tailOrdinal: 1,
    })
    assert.equal(out, 'hi')
  })
})

describe('replaceRegexWithTimeout integration', () => {
  it('validates pattern once before vm replace', () => {
    const bad = replaceRegexWithTimeout('[', '', 'ok', '!')
    assert.equal(bad.ok, false)
    const good = replaceRegexWithTimeout('ok', 'g', 'ok', 'OK')
    assert.equal(good.ok, true)
    if (good.ok) assert.equal(good.text, 'OK')
  })
})

describe('applyRegexPersistToTurnFields', () => {
  it('applies persist phase to user assistant reasoning separately', () => {
    const rules = [
      rule({
        id: '11111111',
        phases: ['persist'],
        fields: ['user', 'assistant', 'reasoning'],
        pattern: 'track',
        replacement: '',
      }),
    ]
    const out = applyRegexPersistToTurnFields({
      userText: 'user track',
      assistantContent: 'assist track',
      assistantReasoning: 'think track',
      turnOrdinal: 5,
      tailOrdinal: 10,
      rules,
    })
    assert.equal(out.userText, 'user ')
    assert.equal(out.assistantContent, 'assist ')
    assert.equal(out.assistantReasoning, 'think ')
  })
})
