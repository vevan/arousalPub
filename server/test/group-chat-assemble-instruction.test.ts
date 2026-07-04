import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
  DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION,
  mergeGroupChatSettings,
} from '../src/shared/group-chat-settings.js'
import { groupChatAssembleInstruction } from '../src/group-chat/instructions.js'

describe('groupChatAssembleInstruction regression', () => {
  const enabled = {
    enabled: true as const,
    defaultSpeakQuota: 2,
    maxSegmentsPerTurn: 8,
    members: {},
  }

  it('next@ concatenates group and continue prompts with newline', () => {
    const text = groupChatAssembleInstruction({
      ...enabled,
      speakerMode: 'next@',
      groupAssembleInstruction: 'GROUP',
      continueAssembleInstruction: 'CONTINUE',
    })
    assert.equal(text, 'GROUP\nCONTINUE')
  })

  it('next@ uses defaults when both prompts empty', () => {
    const text = groupChatAssembleInstruction({
      ...enabled,
      speakerMode: 'next@',
      groupAssembleInstruction: '',
      continueAssembleInstruction: '',
    })
    assert.equal(
      text,
      `${DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION}\n${DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION}`,
    )
  })

  it('dice injects group prompt only', () => {
    assert.equal(
      groupChatAssembleInstruction({
        ...enabled,
        speakerMode: 'dice',
        groupAssembleInstruction: 'GROUP ONLY',
        continueAssembleInstruction: 'IGNORED',
      }),
      'GROUP ONLY',
    )
    assert.equal(
      groupChatAssembleInstruction({
        ...enabled,
        speakerMode: 'dice',
        groupAssembleInstruction: '',
        continueAssembleInstruction: 'IGNORED',
      }),
      DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
    )
  })

  it('sequential injects group prompt only', () => {
    assert.equal(
      groupChatAssembleInstruction({
        ...enabled,
        speakerMode: 'sequential',
        groupAssembleInstruction: '',
        continueAssembleInstruction: 'IGNORED',
      }),
      DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
    )
  })

  it('returns null when group chat disabled', () => {
    assert.equal(
      groupChatAssembleInstruction({
        ...enabled,
        enabled: false,
        speakerMode: 'next@',
      }),
      null,
    )
  })

  it('mergeGroupChatSettings merges split prompts', () => {
    const merged = mergeGroupChatSettings(
      { enabled: true, groupAssembleInstruction: 'g1', continueAssembleInstruction: 'c1' },
      { groupAssembleInstruction: 'g2', continueAssembleInstruction: 'c2' },
    )
    assert.equal(merged.groupAssembleInstruction, 'g2')
    assert.equal(merged.continueAssembleInstruction, 'c2')
  })
})
