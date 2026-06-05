import {
  clearComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from '@/utils/composer-draft-storage'
import type { Ref } from 'vue'

const COMPOSER_DRAFT_SAVE_MS = 400

export function useComposerDraft(opts: {
  getConversationId: () => string
  userInput: Ref<string>
  getUserId: () => string
}) {
  let composerDraftSaveTimer: ReturnType<typeof setTimeout> | null = null

  function flushComposerDraftNow(conversationId: string, text: string): void {
    writeComposerDraft(conversationId, text, opts.getUserId())
  }

  function scheduleComposerDraftSave(conversationId: string, text: string): void {
    const cid = conversationId.trim()
    if (!cid) return
    if (composerDraftSaveTimer) clearTimeout(composerDraftSaveTimer)
    composerDraftSaveTimer = setTimeout(() => {
      composerDraftSaveTimer = null
      flushComposerDraftNow(cid, text)
    }, COMPOSER_DRAFT_SAVE_MS)
  }

  function cancelComposerDraftSaveTimer(): void {
    if (composerDraftSaveTimer) {
      clearTimeout(composerDraftSaveTimer)
      composerDraftSaveTimer = null
    }
  }

  function flushComposerDraftOnPageHide(): void {
    cancelComposerDraftSaveTimer()
    const cid = opts.getConversationId().trim()
    if (cid) flushComposerDraftNow(cid, opts.userInput.value)
  }

  function restoreDraftForConversation(conversationId: string): void {
    const cid = conversationId.trim()
    opts.userInput.value = cid
      ? readComposerDraft(cid, opts.getUserId())
      : ''
  }

  function clearDraftAfterSend(conversationId: string): void {
    clearComposerDraft(conversationId, opts.getUserId())
  }

  function switchConversationDraft(oldId: string | undefined, newId: string): void {
    if (oldId?.trim()) {
      cancelComposerDraftSaveTimer()
      flushComposerDraftNow(oldId, opts.userInput.value)
    }
    restoreDraftForConversation(newId)
  }

  function dispose(): void {
    cancelComposerDraftSaveTimer()
    const cid = opts.getConversationId().trim()
    if (cid) flushComposerDraftNow(cid, opts.userInput.value)
  }

  return {
    scheduleComposerDraftSave,
    flushComposerDraftOnPageHide,
    clearDraftAfterSend,
    switchConversationDraft,
    dispose,
  }
}
