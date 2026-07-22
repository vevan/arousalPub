import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  allocateDistinctMemberColors,
  ensureMemberColors,
  groupChatWithEnsuredMemberColors,
  initialMultiBotGroupChatSettings,
  memberColorsIncomplete,
  normalizeGroupChatMembers,
  parseMemberColor,
} from '../src/shared/group-chat-settings.ts'

describe('group chat member colors', () => {
  it('parseMemberColor accepts hex and lowercases', () => {
    assert.equal(parseMemberColor('#AABBCC'), '#aabbcc')
    assert.equal(parseMemberColor('  #ff00aa  '), '#ff00aa')
    assert.equal(parseMemberColor('#abc'), null)
    assert.equal(parseMemberColor('red'), null)
    assert.equal(parseMemberColor(null), null)
  })

  it('normalizeGroupChatMembers keeps valid color and drops invalid', () => {
    const m = normalizeGroupChatMembers({
      a: { weight: 1, color: '#FF0000' },
      b: { muted: true, color: 'nope' },
      c: { speakQuota: 2 },
    })
    assert.equal(m.a?.color, '#ff0000')
    assert.equal(m.a?.weight, 1)
    assert.equal(m.b?.muted, true)
    assert.equal(m.b?.color, undefined)
    assert.equal(m.c?.color, undefined)
  })

  it('allocateDistinctMemberColors avoids existing and returns unique', () => {
    const colors = allocateDistinctMemberColors(['#e11d48', '#2563eb'], 3)
    assert.equal(colors.length, 3)
    assert.ok(!colors.includes('#e11d48'))
    assert.ok(!colors.includes('#2563eb'))
    assert.equal(new Set(colors).size, 3)
  })

  it('ensureMemberColors preserves existing and fills missing', () => {
    const members = ensureMemberColors(
      ['bot-a', 'bot-b', 'bot-c'],
      {
        'bot-a': { weight: 2, color: '#2563eb' },
        'bot-b': { muted: true },
      },
    )
    assert.equal(members['bot-a']?.color, '#2563eb')
    assert.equal(members['bot-a']?.weight, 2)
    assert.equal(members['bot-b']?.muted, true)
    assert.ok(parseMemberColor(members['bot-b']?.color))
    assert.ok(parseMemberColor(members['bot-c']?.color))
    assert.notEqual(members['bot-b']?.color, members['bot-a']?.color)
    assert.notEqual(members['bot-c']?.color, members['bot-a']?.color)
    assert.notEqual(members['bot-c']?.color, members['bot-b']?.color)
  })

  it('memberColorsIncomplete and groupChatWithEnsuredMemberColors', () => {
    assert.equal(
      memberColorsIncomplete(['a', 'b'], { a: { color: '#2563eb' } }),
      true,
    )
    assert.equal(
      memberColorsIncomplete(['a'], { a: { color: '#2563eb' } }),
      false,
    )
    const disabled = groupChatWithEnsuredMemberColors(
      {
        enabled: false,
        speakerMode: 'dice',
        autoContinue: false,
        confirmContinue: true,
        members: {},
      },
      ['a'],
    )
    assert.equal(disabled.members?.a?.color, undefined)
    const enabled = groupChatWithEnsuredMemberColors(
      {
        enabled: true,
        speakerMode: 'dice',
        autoContinue: false,
        confirmContinue: true,
        members: { a: { weight: 1 } },
      },
      ['a', 'b'],
    )
    assert.ok(parseMemberColor(enabled.members?.a?.color))
    assert.ok(parseMemberColor(enabled.members?.b?.color))
  })

  it('initialMultiBotGroupChatSettings enables dice confirm decay and bot+2 cap', () => {
    const s = initialMultiBotGroupChatSettings(['a', 'b', 'c'])
    assert.equal(s.enabled, true)
    assert.equal(s.speakerMode, 'dice')
    assert.equal(s.autoContinue, false)
    assert.equal(s.confirmContinue, true)
    assert.equal(s.defaultSpeakQuota, 2)
    assert.equal(s.maxSegmentsPerTurn, 5)
    assert.equal(s.decay?.enabled, true)
    assert.ok(parseMemberColor(s.members?.a?.color))
    assert.ok(parseMemberColor(s.members?.b?.color))
    assert.ok(parseMemberColor(s.members?.c?.color))
  })
})
