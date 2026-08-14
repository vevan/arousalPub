import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  emitConversationBranchCreated,
  onConversationBranchCreated,
} from '../../src/utils/conversation-branch-events.js'

const event = {
  conversationId: 'conv-1',
  parentBranchPath: '',
  branchPath: 'branch1',
}

describe('emitConversationBranchCreated', () => {
  const unsubscribers: Array<() => void> = []

  afterEach(() => {
    while (unsubscribers.length > 0) {
      unsubscribers.pop()?.()
    }
  })

  it('still resolves when a listener rejects', async () => {
    const seen: string[] = []
    unsubscribers.push(
      onConversationBranchCreated(async () => {
        seen.push('ok')
      }),
      onConversationBranchCreated(async () => {
        throw new Error('plugin persist failed')
      }),
    )

    await emitConversationBranchCreated(event)
    assert.deepEqual(seen, ['ok'])
  })
})
