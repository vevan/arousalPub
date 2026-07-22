import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from '../src/chat-storage.js'
import { stripTurnForDisk } from '../src/chat-storage.js'
import {
  DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
  DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION,
} from '../src/shared/group-chat-settings.js'
import {
  groupChatAssembleInstruction,
  buildGroupChatSpeakerAudit,
  segmentPickAuditFromCarriedNextSpeaker,
  diceBiddingPick,
  initGroupChatTurnState,
  listEligibleCharacterIds,
  resolveDiceSkipReason,
  pickSequentialSpeaker,
  resolveFirstSegmentSpeaker,
  resolveNextSpeakerForTurn,
  rebuildGroupChatTurnStateFromTurn,
  getTurnGroupChatState,
  validateExplicitFirstSegmentSpeaker,
  validateGroupContinueRequest,
} from '../src/group-chat-turn.js'

describe('group-chat-turn G3', () => {
  const charIds = ['alice-id', 'betty-id', 'charlie-id']
  const charNames = ['Alice', 'Betty', 'Charlie']
  const groupChat = {
    enabled: true,
    speakerMode: 'dice' as const,
    defaultSpeakQuota: 2,
    maxSegmentsPerTurn: 8,
  }

  it('initGroupChatTurnState assigns default quota', () => {
    const state = initGroupChatTurnState(groupChat, charIds)
    assert.equal(state.quotaRemaining['alice-id'], 2)
    assert.equal(state.speakCount['alice-id'], 0)
  })

  it('listEligibleCharacterIds excludes last speaker', () => {
    const state = initGroupChatTurnState(groupChat, charIds)
    const eligible = listEligibleCharacterIds({
      characterIds: charIds,
      settings: groupChat,
      turnState: state,
      lastSpeakerCharacterId: 'alice-id',
    })
    assert.deepEqual(eligible, ['betty-id', 'charlie-id'])
  })

  it('pickSequentialSpeaker respects characterIds order', () => {
    const state = initGroupChatTurnState(groupChat, charIds)
    const speaker = pickSequentialSpeaker({
      characterIds: charIds,
      settings: groupChat,
      turnState: state,
      lastSpeakerCharacterId: null,
    })
    assert.equal(speaker, 'alice-id')
  })

  it('resolveFirstSegmentSpeaker uses dice when enabled without queue', () => {
    const resolved = resolveFirstSegmentSpeaker({
      groupChat,
      characterIds: charIds,
      characterNames: charNames,
      conversationId: 'conv-1',
      turnOrdinal: 0,
      speakerQueueIds: [],
      defaultCharacterId: 'alice-id',
    })
    assert.ok(resolved.speakerCharacterId)
    assert.ok(charIds.includes(resolved.speakerCharacterId!))
  })

  it('validateGroupContinueRequest rejects consecutive speaker', () => {
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [{ id: 'r1', content: 'a' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'a' }],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 0,
      plugins: [],
      groupChatTurnState: initGroupChatTurnState(groupChat, charIds),
    }
    assert.equal(
      validateGroupContinueRequest(
        turn,
        { turnOrdinal: 0, speakerCharacterId: 'alice-id', afterSegmentIndex: 0 },
        'alice-id',
        charIds,
        'alice-id',
        groupChat,
      ),
      'consecutive_speaker',
    )
    assert.equal(
      validateGroupContinueRequest(
        turn,
        { turnOrdinal: 0, speakerCharacterId: 'betty-id', afterSegmentIndex: 0 },
        'betty-id',
        charIds,
        'alice-id',
        groupChat,
      ),
      'ok',
    )
  })

  it('resolveNextSpeakerForTurn ends when all dice fail after first segment', () => {
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [{ id: 'r1', content: 'a' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'a' }],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 0,
      plugins: [],
      groupChatTurnState: {
        quotaRemaining: { 'alice-id': 1, 'betty-id': 1, 'charlie-id': 1 },
        speakCount: { 'alice-id': 1, 'betty-id': 0, 'charlie-id': 0 },
      },
    }
    const noDecay = {
      ...groupChat,
      decay: { enabled: false },
    }
    const result = resolveNextSpeakerForTurn({
      turn,
      characterIds: charIds,
      characterNames: charNames,
      defaultSpeakerCharacterId: 'alice-id',
      groupChat: noDecay,
      conversationId: 'conv-1',
    })
    assert.ok(result.speakerCharacterId)
    assert.notEqual(result.speakerCharacterId, 'alice-id')
  })

  it('diceBiddingPick first-segment all-fail fallback picks highest score', () => {
    const state = initGroupChatTurnState(
      { ...groupChat, decay: { enabled: true, initialRate: 0, floor: 0 } },
      charIds,
    )
    const result = diceBiddingPick({
      groupChat: { ...groupChat, decay: { enabled: true, initialRate: 0, floor: 0 } },
      characterIds: charIds,
      turnState: state,
      segmentCount: 0,
      conversationId: 'conv-fallback',
      turnOrdinal: 0,
    })
    assert.ok(result.speakerCharacterId)
    assert.equal(result.firstSegmentAllFailFallback, true)
    assert.equal(result.turnState.quotaRemaining['alice-id'], 1)
  })

  it('listEligibleCharacterIds excludes unknown quota keys', () => {
    const state = initGroupChatTurnState(groupChat, charIds)
    delete state.quotaRemaining['alice-id']
    const eligible = listEligibleCharacterIds({
      characterIds: charIds,
      settings: groupChat,
      turnState: state,
      lastSpeakerCharacterId: null,
    })
    assert.deepEqual(eligible, ['betty-id', 'charlie-id'])
  })

  it('stripTurnForDisk preserves groupChatTurnState', () => {
    const state = initGroupChatTurnState(groupChat, charIds)
    state.quotaRemaining['alice-id'] = 0
    state.speakCount['alice-id'] = 2
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [],
      activeReceiveIndex: 0,
      segments: [],
      activeSegmentIndex: 0,
      plugins: [],
      groupChatTurnState: state,
    }
    const stripped = stripTurnForDisk(turn)
    assert.deepEqual(stripped.groupChatTurnState, state)
    assert.notEqual(stripped.groupChatTurnState, turn.groupChatTurnState)
  })

  it('rebuildGroupChatTurnStateFromTurn resets quota from remaining segments', () => {
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [{ id: 'r1', content: 'a' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'a' }],
          activeReceiveIndex: 0,
        },
        {
          id: 's2',
          speakerCharacterId: 'betty-id',
          receives: [{ id: 'r2', content: 'b' }],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 1,
      plugins: [],
      groupChatTurnState: {
        quotaRemaining: { 'alice-id': 0, 'betty-id': 0, 'charlie-id': 2 },
        speakCount: { 'alice-id': 2, 'betty-id': 2, 'charlie-id': 0 },
      },
    }
    turn.segments = turn.segments.slice(0, 1)
    const rebuilt = rebuildGroupChatTurnStateFromTurn(
      turn,
      groupChat,
      charIds,
      'alice-id',
    )
    assert.equal(rebuilt.quotaRemaining['alice-id'], 1)
    assert.equal(rebuilt.speakCount['alice-id'], 1)
    assert.equal(rebuilt.quotaRemaining['betty-id'], 2)
    assert.equal(rebuilt.speakCount['betty-id'], 0)
  })

  it('getTurnGroupChatState rebuilds from segments when groupChatTurnState missing', () => {
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [{ id: 'r1', content: 'a' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'a' }],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 0,
      plugins: [],
    }
    const state = getTurnGroupChatState(turn, groupChat, charIds, 'alice-id')
    assert.equal(state.quotaRemaining['alice-id'], 1)
    assert.equal(state.speakCount['alice-id'], 1)
  })

  it('rebuildGroupChatTurnStateFromTurn preserves skipQuota on firstSegmentAllFailFallback', () => {
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: '' },
      receives: [{ id: 'r1', content: 'opening' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'opening' }],
          activeReceiveIndex: 0,
          meta: {
            segmentPickAudit: {
              speakerMode: 'dice',
              phase: 'firstSegment',
              method: 'dice',
              segmentIndex: 0,
              firstSegmentAllFailFallback: true,
              dice: {
                segmentCount: 0,
                bids: [],
                winnerCharacterId: 'alice-id',
                outcome: 'allFailedFirstSegmentFallback',
              },
            },
          },
        },
      ],
      activeSegmentIndex: 0,
      plugins: [],
    }
    const rebuilt = rebuildGroupChatTurnStateFromTurn(
      turn,
      groupChat,
      charIds,
      'alice-id',
    )
    assert.equal(rebuilt.quotaRemaining['alice-id'], 2)
    assert.equal(rebuilt.speakCount['alice-id'], 1)
  })

  it('regen truncate simulates updateTurnSegmentInTailChunk slice + rebuild', () => {
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [{ id: 'r1', content: 'a' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'a' }],
          activeReceiveIndex: 0,
        },
        {
          id: 's2',
          speakerCharacterId: 'betty-id',
          receives: [{ id: 'r2', content: 'b' }],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 1,
      plugins: [],
      groupChatTurnState: {
        quotaRemaining: { 'alice-id': 0, 'betty-id': 0, 'charlie-id': 2 },
        speakCount: { 'alice-id': 2, 'betty-id': 2, 'charlie-id': 0 },
      },
    }
    turn.segments = turn.segments.slice(0, 1)
    turn.activeSegmentIndex = 0
    turn.groupChatTurnState = rebuildGroupChatTurnStateFromTurn(
      turn,
      groupChat,
      charIds,
      'alice-id',
    )
    assert.equal(turn.segments.length, 1)
    assert.equal(turn.groupChatTurnState.quotaRemaining['alice-id'], 1)
    assert.equal(turn.groupChatTurnState.quotaRemaining['betty-id'], 2)
    assert.equal(turn.groupChatTurnState.speakCount['betty-id'], 0)
  })

  it('validateExplicitFirstSegmentSpeaker rejects ineligible speaker', () => {
    const mutedChat = {
      ...groupChat,
      members: { 'alice-id': { muted: true } },
    }
    const result = validateExplicitFirstSegmentSpeaker({
      explicitSpeakerId: 'alice-id',
      groupChat: mutedChat,
      characterIds: charIds,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'not_eligible')
  })

  it('resolveFirstSegmentSpeaker sequential returns null when no eligible', () => {
    const mutedAll = {
      ...groupChat,
      speakerMode: 'sequential' as const,
      members: Object.fromEntries(charIds.map((id) => [id, { muted: true }])),
    }
    const resolved = resolveFirstSegmentSpeaker({
      groupChat: mutedAll,
      characterIds: charIds,
      characterNames: charNames,
      conversationId: 'conv-muted',
      turnOrdinal: 0,
      speakerQueueIds: [],
      defaultCharacterId: 'alice-id',
    })
    assert.equal(resolved.speakerCharacterId, null)
  })

  it('groupChatAssembleInstruction next@ concatenates group and continue', () => {
    assert.equal(
      groupChatAssembleInstruction({
        ...groupChat,
        speakerMode: 'next@',
        enabled: true,
        groupAssembleInstruction: '',
        continueAssembleInstruction: '',
      }),
      `${DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION}\n${DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION}`,
    )
    assert.equal(
      groupChatAssembleInstruction({ ...groupChat, speakerMode: 'dice' }),
      DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
    )
    assert.equal(groupChatAssembleInstruction({ ...groupChat, enabled: false }), null)
  })

  it('diceBiddingPick records full roster with dice audit rows', () => {
    const state = initGroupChatTurnState(groupChat, charIds)
    const result = diceBiddingPick({
      groupChat,
      characterIds: charIds,
      turnState: state,
      segmentCount: 0,
      conversationId: 'conv-audit',
      turnOrdinal: 0,
      lastSpeakerCharacterId: null,
    })
    assert.ok(result.diceAudit)
    assert.equal(result.diceAudit!.bids.length, 3)
    assert.ok(
      result.diceAudit!.bids.every(
        (b) => b.eligible && typeof b.roll === 'number' && typeof b.score === 'number',
      ),
    )
  })

  it('diceBiddingPick marks consecutive skip for last speaker', () => {
    const state = initGroupChatTurnState(groupChat, charIds)
    const result = diceBiddingPick({
      groupChat,
      characterIds: charIds,
      turnState: state,
      segmentCount: 1,
      conversationId: 'conv-skip',
      turnOrdinal: 0,
      lastSpeakerCharacterId: 'alice-id',
    })
    const alice = result.diceAudit!.bids.find((b) => b.characterId === 'alice-id')
    assert.ok(alice)
    assert.equal(alice!.eligible, false)
    assert.equal(alice!.skipReason, 'consecutive')
    assert.equal(alice!.quotaRemaining, 2)
  })

  it('resolveDiceSkipReason matches listEligibleCharacterIds', () => {
    const state = initGroupChatTurnState(groupChat, charIds)
    const last = 'alice-id'
    for (const id of charIds) {
      const skip = resolveDiceSkipReason(id, {
        settings: groupChat,
        turnState: state,
        lastSpeakerCharacterId: last,
      })
      const eligible = listEligibleCharacterIds({
        characterIds: charIds,
        settings: groupChat,
        turnState: state,
        lastSpeakerCharacterId: last,
      }).includes(id)
      assert.equal(skip === null, eligible)
    }
  })

  it('segmentPickAuditFromCarriedNextSpeaker reuses dice from previous segment meta', () => {
    const state = initGroupChatTurnState(groupChat, charIds)
    const dice = diceBiddingPick({
      groupChat,
      characterIds: charIds,
      turnState: state,
      segmentCount: 0,
      conversationId: 'conv-carry',
      turnOrdinal: 0,
      lastSpeakerCharacterId: null,
    })
    const nextAudit = buildGroupChatSpeakerAudit(groupChat, 'nextAfterSegment', 'dice', 1, {
      speakerCharacterId: dice.speakerCharacterId,
      dice: dice.diceAudit,
    })
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [{ id: 'r1', content: 'a' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'a' }],
          activeReceiveIndex: 0,
          meta: { resolvedNextSpeakerAudit: nextAudit },
        },
      ],
      activeSegmentIndex: 0,
    }
    const picked = segmentPickAuditFromCarriedNextSpeaker({
      groupChat,
      turn,
      defaultSpeakerCharacterId: 'alice-id',
      speakerCharacterId: dice.speakerCharacterId!,
      segmentIndex: 1,
    })
    assert.ok(picked)
    assert.equal(picked!.method, 'dice')
    assert.ok(picked!.dice?.bids.length)
  })

  it('segmentPickAuditFromCarriedNextSpeaker reuses queue method from previous segment', () => {
    const nextAudit = buildGroupChatSpeakerAudit(groupChat, 'nextAfterSegment', 'queue', 1, {
      speakerCharacterId: 'betty-id',
    })
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [{ id: 'r1', content: 'a' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'a' }],
          activeReceiveIndex: 0,
          meta: { resolvedNextSpeakerAudit: nextAudit },
        },
      ],
      activeSegmentIndex: 0,
    }
    const picked = segmentPickAuditFromCarriedNextSpeaker({
      groupChat,
      turn,
      defaultSpeakerCharacterId: 'alice-id',
      speakerCharacterId: 'betty-id',
      segmentIndex: 1,
    })
    assert.ok(picked)
    assert.equal(picked!.method, 'queue')
    assert.equal(picked!.speakerCharacterId, 'betty-id')
  })

  it('stripTurnForDisk strips duplicate resolvedNextSpeakerAudit but keeps segmentPickAudit', () => {
    const carryAudit = buildGroupChatSpeakerAudit(groupChat, 'nextAfterSegment', 'dice', 0, {
      speakerCharacterId: 'betty-id',
    })
    const pickAudit = buildGroupChatSpeakerAudit(groupChat, 'firstSegment', 'dice', 0, {
      speakerCharacterId: 'alice-id',
    })
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [{ id: 'r2', content: 'b' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'a' }],
          activeReceiveIndex: 0,
          meta: {
            resolvedNextSpeakerAudit: carryAudit,
            segmentPickAudit: pickAudit,
          },
        },
        {
          id: 's2',
          speakerCharacterId: 'betty-id',
          receives: [{ id: 'r2', content: 'b' }],
          activeReceiveIndex: 0,
          meta: {
            resolvedNextSpeakerAudit: buildGroupChatSpeakerAudit(
              groupChat,
              'nextAfterSegment',
              'queue',
              2,
              { speakerCharacterId: 'charlie-id' },
            ),
          },
        },
      ],
      activeSegmentIndex: 1,
      plugins: [],
    }
    const stripped = stripTurnForDisk(turn)
    assert.ok(stripped.segments[0].meta?.resolvedNextSpeakerAudit)
    assert.ok(stripped.segments[0].meta?.segmentPickAudit)
    assert.equal(stripped.segments[1].meta?.resolvedNextSpeakerAudit, undefined)
  })

  it('resolveFirstSegmentSpeaker includes groupChatAudit on dice path', () => {
    const resolved = resolveFirstSegmentSpeaker({
      groupChat,
      characterIds: charIds,
      characterNames: charNames,
      conversationId: 'conv-audit2',
      turnOrdinal: 0,
      speakerQueueIds: [],
      defaultCharacterId: 'alice-id',
    })
    assert.equal(resolved.groupChatAudit?.method, 'dice')
    assert.ok(resolved.groupChatAudit?.dice?.bids.length)
    assert.equal(resolved.groupChatAudit?.maxSegmentsPerTurn, 8)
  })

  it('next@ mode needs manual continue when hint missing', () => {
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [{ id: 'r1', content: 'a' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'a' }],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 0,
      plugins: [],
      groupChatTurnState: initGroupChatTurnState(groupChat, charIds),
    }
    const result = resolveNextSpeakerForTurn({
      turn,
      characterIds: charIds,
      characterNames: charNames,
      defaultSpeakerCharacterId: 'alice-id',
      groupChat: { ...groupChat, speakerMode: 'next@' },
      conversationId: 'conv-1',
    })
    assert.equal(result.speakerCharacterId, null)
    assert.equal(result.needsManualContinue, true)
  })
})
