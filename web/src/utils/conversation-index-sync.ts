type ConversationIndexPatchedListener = (
  conversationId: string,
  index: Record<string, unknown>,
) => void

const listeners = new Set<ConversationIndexPatchedListener>()

export function onConversationIndexPatched(
  listener: ConversationIndexPatchedListener,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitConversationIndexPatched(
  conversationId: string,
  index: Record<string, unknown>,
): void {
  const id = conversationId.trim()
  if (!id) return
  for (const listener of listeners) {
    listener(id, index)
  }
}
