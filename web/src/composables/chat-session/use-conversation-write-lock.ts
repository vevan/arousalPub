import {
  patchConversationTurns,
  readConversationTurnsRange,
  ConversationHostError,
  type ConversationBatchContext,
} from '@/plugins/conversation-host'
import type { ConversationScopeOptions } from '@/plugins/types'
import { ref, type Ref } from 'vue'

export function useConversationWriteLock(opts: {
  getConversationId: () => string
  loading: Ref<boolean>
  regeneratingTurnOrdinal: Ref<number | null>
}) {
  const conversationWriteLocked = ref(false)

  function isConversationWritable(): boolean {
    return !conversationWriteLocked.value
  }

  async function runConversationScope(
    scopeOpts: ConversationScopeOptions,
    fn: (ctx: ConversationBatchContext) => Promise<void>,
  ): Promise<void> {
    const writeLock = scopeOpts.writeLock !== false
    const requireIdle = scopeOpts.requireIdle !== false
    if (writeLock && conversationWriteLocked.value) {
      throw new ConversationHostError('conversation_locked')
    }
    if (
      requireIdle &&
      (opts.loading.value || opts.regeneratingTurnOrdinal.value !== null)
    ) {
      throw new ConversationHostError('conversation_busy')
    }
    if (writeLock) conversationWriteLocked.value = true
    try {
      const cid = opts.getConversationId()
      await fn({
        conversationId: cid,
        read: (readOpts) => readConversationTurnsRange(cid, readOpts.range),
        patchTurns: (dtos) => patchConversationTurns(cid, dtos),
      })
    } finally {
      if (writeLock) conversationWriteLocked.value = false
    }
  }

  async function runConversationBatch(
    fn: (ctx: ConversationBatchContext) => Promise<void>,
  ): Promise<void> {
    return runConversationScope({ writeLock: true, requireIdle: true }, fn)
  }

  return {
    conversationWriteLocked,
    isConversationWritable,
    runConversationScope,
    runConversationBatch,
  }
}
