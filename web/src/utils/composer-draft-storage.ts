/** 各会话输入框未发送草稿（localStorage） */
export const COMPOSER_DRAFT_STORAGE_PREFIX = 'arousal-composer-draft'

/** 单条草稿字符上限（防误粘贴超大段） */
export const COMPOSER_DRAFT_MAX_CHARS = 100_000

export function composerDraftStorageKey(
  conversationId: string,
  userId?: string | null,
): string {
  const uid = typeof userId === 'string' && userId.trim() ? userId.trim() : 'anonymous'
  const cid = conversationId.trim()
  return `${COMPOSER_DRAFT_STORAGE_PREFIX}:${uid}:${cid}`
}

export function readComposerDraft(
  conversationId: string,
  userId?: string | null,
): string {
  const cid = conversationId.trim()
  if (!cid) return ''
  try {
    const raw = localStorage.getItem(composerDraftStorageKey(cid, userId))
    return typeof raw === 'string' ? raw : ''
  } catch {
    return ''
  }
}

export function writeComposerDraft(
  conversationId: string,
  text: string,
  userId?: string | null,
): void {
  const cid = conversationId.trim()
  if (!cid) return
  const key = composerDraftStorageKey(cid, userId)
  try {
    if (!text) {
      localStorage.removeItem(key)
      return
    }
    const clipped =
      text.length > COMPOSER_DRAFT_MAX_CHARS
        ? text.slice(0, COMPOSER_DRAFT_MAX_CHARS)
        : text
    localStorage.setItem(key, clipped)
  } catch {
    /* quota / private mode */
  }
}

export function clearComposerDraft(
  conversationId: string,
  userId?: string | null,
): void {
  writeComposerDraft(conversationId, '', userId)
}
