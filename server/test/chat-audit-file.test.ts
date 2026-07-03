import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildChatAuditEntry } from '../src/chat-audit-file.js'

describe('buildChatAuditEntry', () => {
  it('includes groupChat snapshot when present', () => {
    const entry = buildChatAuditEntry(
      {
        savedAt: '2026-07-03T00:00:00.000Z',
        chunkName: 'branch1/chunk-0001.json',
        turnId: 't1',
        turnOrdinal: 0,
      },
      [{ role: 'user', content: 'hi' }],
      {
        messages: [{ role: 'user', content: 'hi' }],
        groupChat: {
          segmentSpeakerCharacterId: 'char1',
          segmentPick: {
            phase: 'firstSegment',
            method: 'dice',
            segmentIndex: 0,
            dice: {
              segmentCount: 0,
              bids: [
                {
                  characterId: 'char1',
                  eligible: true,
                  quotaRemaining: 2,
                  speakCount: 0,
                  probability: 0.5,
                  roll: 0.3,
                  passed: true,
                  score: 0.3,
                  weight: 1,
                },
              ],
              winnerCharacterId: 'char1',
              outcome: 'winner',
            },
          },
        },
      },
    )
    assert.ok(entry.groupChat?.segmentPick?.dice?.bids.length === 1)
    assert.equal(entry.segmentIndex, 0)
  })

  it('includes segmentIndex and receiveId when provided', () => {
    const entry = buildChatAuditEntry(
      {
        savedAt: '2026-07-03T00:00:00.000Z',
        chunkName: 'chunk-0001.json',
        turnId: 't1',
        turnOrdinal: 3,
        segmentIndex: 2,
        receiveId: 'r9',
      },
      [{ role: 'assistant', content: 'seg2' }],
      { messages: [{ role: 'assistant', content: 'seg2' }] },
    )
    assert.equal(entry.segmentIndex, 2)
    assert.equal(entry.receiveId, 'r9')
  })
})
