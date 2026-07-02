import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chatListEntryNeedsEnrich, listLastChatAtFromStats } from '../src/character-storage.js'
import type { ChatListEntry } from '../src/chat-storage.js'

function stubEntry(partial: Partial<ChatListEntry> = {}): ChatListEntry {
  return {
    conversationId: 'abc12345',
    title: 'test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    characterIds: ['c1c1c1c1'],
    characterNames: ['Char'],
    searchTags: ['tag'],
    activeTurnCount: 0,
    ...partial,
  }
}

describe('chatListEntryNeedsEnrich', () => {
  it('does not require lastChatAt when activeTurnCount is 0', () => {
    assert.equal(chatListEntryNeedsEnrich(stubEntry({ activeTurnCount: 0 })), false)
  })

  it('requires lastChatAt when activeTurnCount > 0', () => {
    assert.equal(chatListEntryNeedsEnrich(stubEntry({ activeTurnCount: 3 })), true)
  })

  it('is satisfied when count and lastChatAt are present', () => {
    assert.equal(
      chatListEntryNeedsEnrich(
        stubEntry({
          activeTurnCount: 2,
          lastChatAt: '2026-01-02T00:00:00.000Z',
        }),
      ),
      false,
    )
  })

  it('still requires activeTurnCount when missing', () => {
    const { activeTurnCount: _drop, ...withoutCount } = stubEntry()
    assert.equal(chatListEntryNeedsEnrich(withoutCount as ChatListEntry), true)
  })
})

describe('listLastChatAtFromStats', () => {
  it('falls back to updatedAt when turn has no createdAt', () => {
    assert.equal(
      listLastChatAtFromStats(
        { turnCount: 3, lastChatAt: null },
        '2026-03-01T12:00:00.000Z',
      ),
      '2026-03-01T12:00:00.000Z',
    )
  })

  it('returns undefined for empty conversations', () => {
    assert.equal(
      listLastChatAtFromStats(
        { turnCount: 0, lastChatAt: null },
        '2026-03-01T12:00:00.000Z',
      ),
      undefined,
    )
  })
})
