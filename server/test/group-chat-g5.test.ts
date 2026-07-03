import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GROUP_CHAT_DICE_INSTRUCTION,
  GROUP_CHAT_NEXT_AT_INSTRUCTION,
  GROUP_CHAT_SEQUENTIAL_INSTRUCTION,
  buildGroupChatNotChar,
  groupChatAssembleInstruction,
  groupChatNextAtInstruction,
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
  }

  it('groupChatAssembleInstruction branches by speakerMode', () => {
    assert.equal(
      groupChatAssembleInstruction({ ...groupChat, speakerMode: 'sequential' }),
      GROUP_CHAT_SEQUENTIAL_INSTRUCTION,
    )
    assert.equal(
      groupChatAssembleInstruction({ ...groupChat, speakerMode: 'dice' }),
      GROUP_CHAT_DICE_INSTRUCTION,
    )
    assert.equal(
      groupChatAssembleInstruction({ ...groupChat, speakerMode: 'next@' }),
      GROUP_CHAT_NEXT_AT_INSTRUCTION,
    )
    assert.equal(groupChatAssembleInstruction({ ...groupChat, enabled: false }), null)
  })

  it('groupChatNextAtInstruction only for next@ mode', () => {
    assert.equal(
      groupChatNextAtInstruction({ ...groupChat, speakerMode: 'next@', enabled: true }),
      GROUP_CHAT_NEXT_AT_INSTRUCTION,
    )
    assert.equal(groupChatNextAtInstruction({ ...groupChat, speakerMode: 'dice' }), null)
    assert.equal(groupChatNextAtInstruction({ ...groupChat, enabled: false }), null)
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
})
