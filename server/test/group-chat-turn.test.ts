import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from '../src/chat-storage.js'
import {
  buildGroupMacroStrings,
  computeGroupChatContinueProbability,
  extractNextSpeakerHint,
  getTurnSegments,
  mergeGroupChatSettings,
  parseGroupContinueBody,
  resolveNextSpeaker,
  resolveNextSpeakerWithDecay,
  resolveOutboundSpeakerCharacterId,
  resolveSpeakerQueueIds,
  validateGroupContinueRequest,
} from '../src/group-chat-turn.js'

describe('group-chat-turn', () => {
  const charIds = ['alice-id', 'betty-id']
  const charNames = ['Alice', 'Betty']

  it('resolves speaker queue from display names', () => {
    assert.deepEqual(
      resolveSpeakerQueueIds(['Alice', 'Betty'], charIds, charNames),
      ['alice-id', 'betty-id'],
    )
  })

  it('extracts last [NEXT@Name] and strips markers', () => {
    const raw = 'Hello [NEXT@Alice] world [NEXT@Betty]'
    const { content, hintCharacterId } = extractNextSpeakerHint(
      raw,
      charIds,
      charNames,
    )
    assert.equal(content, 'Hello  world')
    assert.equal(hintCharacterId, 'betty-id')
  })

  it('reads segments from turn', () => {
    const turn: TurnRecord = {
      turnId: 't1',
      turnOrdinal: 0,
      send: { userText: 'hi' },
      receives: [{ id: 'r1', content: 'yo' }],
      activeReceiveIndex: 0,
      segments: [
        {
          id: 's1',
          speakerCharacterId: 'alice-id',
          receives: [{ id: 'r1', content: 'yo' }],
          activeReceiveIndex: 0,
        },
      ],
      activeSegmentIndex: 0,
      plugins: [],
    }
    const segments = getTurnSegments(turn, 'alice-id')
    assert.equal(segments.length, 1)
    assert.equal(segments[0]!.speakerCharacterId, 'alice-id')
    assert.equal(segments[0]!.receives[0]!.content, 'yo')
  })

  it('resolveOutboundSpeakerCharacterId uses /@ queue when group chat off', () => {
    assert.equal(
      resolveOutboundSpeakerCharacterId({
        groupChatEnabled: false,
        characterIds: charIds,
        characterNames: charNames,
        defaultCharacterId: 'alice-id',
        speakerQueueIds: ['betty-id'],
      }),
      'betty-id',
    )
  })

  it('resolveOutboundSpeakerCharacterId truncates multi queue when group chat off', () => {
    assert.equal(
      resolveOutboundSpeakerCharacterId({
        groupChatEnabled: false,
        characterIds: charIds,
        characterNames: charNames,
        defaultCharacterId: 'alice-id',
        speakerQueueIds: ['betty-id', 'alice-id'],
      }),
      'betty-id',
    )
  })

  it('validateGroupContinueRequest rejects stale afterSegmentIndex', () => {
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
    assert.equal(
      validateGroupContinueRequest(
        turn,
        { turnOrdinal: 0, speakerCharacterId: 'betty-id', afterSegmentIndex: 0 },
        'betty-id',
        charIds,
        'alice-id',
      ),
      'ok',
    )
    assert.equal(
      validateGroupContinueRequest(
        turn,
        { turnOrdinal: 0, speakerCharacterId: 'betty-id', afterSegmentIndex: 1 },
        'betty-id',
        charIds,
        'alice-id',
      ),
      'invalid_after_segment',
    )
  })

  it('parseGroupContinueBody requires afterSegmentIndex', () => {
    assert.equal(
      parseGroupContinueBody({
        turnOrdinal: 0,
        speakerCharacterId: 'betty-id',
      }),
      null,
    )
    assert.deepEqual(
      parseGroupContinueBody({
        turnOrdinal: 0,
        speakerCharacterId: 'betty-id',
        afterSegmentIndex: 0,
      }),
      {
        turnOrdinal: 0,
        speakerCharacterId: 'betty-id',
        afterSegmentIndex: 0,
      },
    )
  })

  it('resolveNextSpeaker prefers speakerQueue', () => {
    const next = resolveNextSpeaker({
      groupChatEnabled: true,
      speakerQueue: ['alice-id', 'betty-id'],
      spokenCharacterIds: ['alice-id'],
      characterIds: charIds,
    })
    assert.equal(next, 'betty-id')
  })

  it('resolveNextSpeaker skips muted members in queue', () => {
    const next = resolveNextSpeaker({
      groupChatEnabled: true,
      groupChatSettings: {
        enabled: true,
        members: { 'betty-id': { muted: true } },
      },
      speakerQueue: ['betty-id', 'alice-id'],
      spokenCharacterIds: [],
      characterIds: charIds,
    })
    assert.equal(next, 'alice-id')
  })

  it('buildGroupMacroStrings respects mute', () => {
    const macros = buildGroupMacroStrings(charIds, charNames, {
      enabled: true,
      members: { 'betty-id': { muted: true } },
    })
    assert.equal(macros.group, 'Alice, Betty')
    assert.equal(macros.groupNotMuted, 'Alice')
  })

  it('computeGroupChatContinueProbability decays by segment index', () => {
    assert.equal(computeGroupChatContinueProbability(0, {}), null)
    assert.equal(computeGroupChatContinueProbability(1, {}), 1)
    assert.equal(
      computeGroupChatContinueProbability(2, {
        enabled: true,
        initialRate: 1,
        step: 0.2,
        floor: 0,
      }),
      0.8,
    )
  })

  it('resolveNextSpeakerWithDecay stops when roll fails', () => {
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
    }
    const threeIds = ['alice-id', 'betty-id', 'charlie-id']
    const result = resolveNextSpeakerWithDecay({
      turn,
      characterIds: threeIds,
      characterNames: ['Alice', 'Betty', 'Charlie'],
      defaultSpeakerCharacterId: 'alice-id',
      groupChat: { enabled: true },
      conversationId: 'conv-1',
      random: () => 0.99,
    })
    assert.equal(result.speakerCharacterId, null)
    assert.equal(result.decayStopped, true)
  })

  it('resolveNextSpeakerWithDecay ends quietly when no candidates', () => {
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
    }
    const result = resolveNextSpeakerWithDecay({
      turn,
      characterIds: charIds,
      characterNames: charNames,
      defaultSpeakerCharacterId: 'alice-id',
      groupChat: { enabled: true },
      conversationId: 'conv-1',
      random: () => 0.99,
    })
    assert.equal(result.speakerCharacterId, null)
    assert.equal(result.decayStopped, undefined)
  })

  it('mergeGroupChatSettings merges partial patch', () => {
    const merged = mergeGroupChatSettings(
      { enabled: false, autoContinue: false },
      { enabled: true, autoContinue: true },
    )
    assert.equal(merged.enabled, true)
    assert.equal(merged.autoContinue, true)
    assert.equal(merged.confirmContinue, true)
  })

  it('mergeGroupChatSettings merges members shallowly', () => {
    const merged = mergeGroupChatSettings(
      {
        enabled: true,
        members: {
          'alice-id': { weight: 2, muted: false },
          'betty-id': { weight: 1, muted: false },
        },
      },
      { members: { 'alice-id': { muted: true } } },
    )
    assert.equal(merged.members?.['alice-id']?.muted, true)
    assert.equal(merged.members?.['alice-id']?.weight, 2)
    assert.equal(merged.members?.['betty-id']?.weight, 1)
  })
})
