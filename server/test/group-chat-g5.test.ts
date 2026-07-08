import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
  DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION,
} from '../src/shared/group-chat-settings.js'
import {
  buildGroupChatNotChar,
  groupChatAssembleInstruction,
} from '../src/group-chat-turn.js'
import { buildPromptMacroContext } from '../src/prompt-macros/context.js'
import { renderPromptMacrosCst } from '../src/prompt-macros/cst/render.js'

describe('group-chat G5', () => {
  const charIds = ['alice-id', 'betty-id', 'charlie-id']
  const charNames = ['Alice', 'Betty', 'Charlie']
  const groupChat = {
    enabled: true,
    speakerMode: 'dice' as const,
    defaultSpeakQuota: 2,
    maxSegmentsPerTurn: 8,
    members: {},
    groupAssembleInstruction: '',
    continueAssembleInstruction: '',
  }

  it('groupChatAssembleInstruction dice mode uses group prompt only', () => {
    assert.equal(
      groupChatAssembleInstruction({
        ...groupChat,
        speakerMode: 'dice',
        groupAssembleInstruction: 'G',
        continueAssembleInstruction: 'C',
      }),
      'G',
    )
    assert.equal(groupChatAssembleInstruction({ ...groupChat, enabled: false }), null)
  })

  it('buildGroupChatNotChar excludes current speaker when group enabled', () => {
    assert.equal(
      buildGroupChatNotChar({
        groupChatEnabled: true,
        characterIds: charIds,
        characterNames: charNames,
        speakerCharacterId: 'betty-id',
      }),
      'Alice, Charlie',
    )
    assert.equal(
      buildGroupChatNotChar({
        groupChatEnabled: true,
        characterIds: charIds,
        characterNames: charNames,
        speakerCharacterId: 'alice-id',
      }),
      'Betty, Charlie',
    )
  })

  it('buildGroupChatNotChar non-group keeps slice(1) semantics', () => {
    assert.equal(
      buildGroupChatNotChar({
        groupChatEnabled: false,
        characterIds: charIds,
        characterNames: charNames,
        speakerCharacterId: 'betty-id',
      }),
      'Betty, Charlie',
    )
  })

  it('{{charIfNotGroup}} empty when group enabled, else {{char}}', () => {
    const chars = charNames.map((name) => ({ name }))
    const groupCtx = buildPromptMacroContext({
      characters: chars,
      groupChatEnabled: true,
    })
    assert.equal(renderPromptMacrosCst('{{charIfNotGroup}}', groupCtx), '')

    const soloCtx = buildPromptMacroContext({
      characters: chars,
      groupChatEnabled: false,
    })
    assert.equal(renderPromptMacrosCst('{{charIfNotGroup}}', soloCtx), 'Alice')
  })

  it('default constants match expected split', () => {
    assert.match(DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION, /\{\{char\}\}/)
    assert.doesNotMatch(DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION, /\[NEXT@/)
    assert.match(DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION, /\[NEXT@CharacterName\]/)
    assert.equal(
      groupChatAssembleInstruction({
        ...groupChat,
        speakerMode: 'next@',
      }),
      `${DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION}\n${DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION}`,
    )
  })
})
