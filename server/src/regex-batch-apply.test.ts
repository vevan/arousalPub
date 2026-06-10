import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from './chat-storage.js'
import {
  parseRegexBatchApplyBody,
  turnContentPatchChanged,
  turnRecordToContentPatch,
} from './regex-batch-apply.js'
import { applyRegexPersistToTurnPatch } from './regex-persist-patch.js'
import type { RegexRule } from './regex-rules-types.js'

function rule(partial: Partial<RegexRule> & Pick<RegexRule, 'id'>): RegexRule {
  return {
    label: partial.label ?? partial.id,
    order: partial.order ?? 10,
    enabled: partial.enabled ?? true,
    phases: partial.phases ?? ['persist'],
    fields: partial.fields ?? ['user', 'assistant'],
    skipLastNTurns: partial.skipLastNTurns ?? 0,
    pattern: partial.pattern ?? '',
    flags: partial.flags ?? 'g',
    replacement: partial.replacement ?? '',
    ...partial,
  }
}

describe('RegexBatchApplyResult', () => {
  it('includes memoryEmbedsQueued zero on dry run base shape', () => {
    const base = {
      dryRun: true,
      fromOrdinal: 0,
      toOrdinal: 1,
      turnCount: 2,
      changedTurnCount: 1,
      memoryEmbedsQueued: 0,
    }
    assert.equal(base.memoryEmbedsQueued, 0)
  })
})

describe('parseRegexBatchApplyBody', () => {
  it('parses dryRun and range', () => {
    const r = parseRegexBatchApplyBody({
      dryRun: true,
      fromOrdinal: 1,
      toOrdinal: 5,
      ruleIds: 'all',
    })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.request.dryRun, true)
    assert.equal(r.request.fromOrdinal, 1)
    assert.equal(r.request.toOrdinal, 5)
    assert.equal(r.request.ruleIds, 'all')
  })
})

describe('turnRecordToContentPatch', () => {
  it('maps turn record to patch input', () => {
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 2,
      send: { userText: 'u...' },
      receives: [{ id: 'r1', content: 'a...' }],
      activeReceiveIndex: 0,
      plugins: [],
    }
    const patch = turnRecordToContentPatch(turn)
    assert.equal(patch.turnOrdinal, 2)
    assert.equal(patch.userText, 'u...')
    assert.equal(patch.receives[0]?.content, 'a...')
  })
})

describe('regex batch persist patches', () => {
  it('builds one patch per changed turn regardless of rule count', () => {
    const rules = [
      rule({ id: '11111111', pattern: '\\.{3,}', replacement: '…', fields: ['user'] }),
      rule({ id: '22222222', order: 20, pattern: '\\.{3,}', replacement: '…', fields: ['assistant'] }),
      rule({ id: '33333333', order: 30, pattern: 'foo', replacement: 'bar', fields: ['assistant'] }),
    ]
    const turns: TurnRecord[] = [
      {
        turnId: 't0',
        turnOrdinal: 0,
        send: { userText: 'a...' },
        receives: [{ id: 'r0', content: 'b...' }],
        activeReceiveIndex: 0,
        plugins: [],
      },
      {
        turnId: 't1',
        turnOrdinal: 1,
        send: { userText: 'same' },
        receives: [{ id: 'r1', content: 'same' }],
        activeReceiveIndex: 0,
        plugins: [],
      },
    ]
    const patches = []
    for (const turn of turns) {
      const original = turnRecordToContentPatch(turn)
      const normalized = applyRegexPersistToTurnPatch(rules, original, 1)
      if (turnContentPatchChanged(original, normalized)) {
        patches.push(normalized)
      }
    }
    assert.equal(patches.length, 1)
    assert.equal(patches[0]?.userText, 'a…')
    assert.equal(patches[0]?.receives[0]?.content, 'b…')
  })
})
