import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  resolveFirstSegmentSpeaker,
  resolveFirstSegmentSpeakerId,
  seededUnit,
} from '../src/group-chat-turn.js'

describe('group-chat-pick seededUnit', () => {
  it('matches node:crypto sha256 first uint32 / 0xffffffff', () => {
    const seeds = [
      'conv\x000\x000\x00alice-id\x00roll',
      'c1\x001\x000\x00betty\x00score',
      '',
      '中文种子',
    ]
    for (const seed of seeds) {
      const node =
        createHash('sha256').update(seed).digest().readUInt32BE(0) / 0xffffffff
      assert.equal(seededUnit(seed), node)
    }
  })
})

describe('resolveFirstSegmentSpeakerId', () => {
  const charIds = ['alice-id', 'betty-id', 'charlie-id']
  const charNames = ['Alice', 'Betty', 'Charlie']
  const groupChat = {
    enabled: true,
    speakerMode: 'dice' as const,
    members: {},
    decay: { enabled: false, initialRate: 1, step: 0.2, floor: 0 },
    maxSegmentsPerTurn: 5,
    speakQuota: 2,
    confirmContinue: false,
  }

  it('matches resolveFirstSegmentSpeaker speaker id for dice', () => {
    for (let turnOrdinal = 0; turnOrdinal < 12; turnOrdinal++) {
      const full = resolveFirstSegmentSpeaker({
        groupChat,
        characterIds: charIds,
        characterNames: charNames,
        conversationId: 'conv-predict',
        turnOrdinal,
        speakerQueueIds: [],
        defaultCharacterId: charIds[0]!,
      })
      const idOnly = resolveFirstSegmentSpeakerId({
        groupChat,
        characterIds: charIds,
        conversationId: 'conv-predict',
        turnOrdinal,
        speakerQueueIds: [],
        defaultCharacterId: charIds[0]!,
      })
      assert.equal(idOnly, full.speakerCharacterId)
    }
  })

  it('uses queue head when present', () => {
    const id = resolveFirstSegmentSpeakerId({
      groupChat,
      characterIds: charIds,
      conversationId: 'conv-q',
      turnOrdinal: 0,
      speakerQueueIds: ['charlie-id', 'alice-id'],
      defaultCharacterId: charIds[0]!,
    })
    assert.equal(id, 'charlie-id')
  })
})
