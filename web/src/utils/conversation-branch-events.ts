export interface ConversationBranchCreatedEvent {
  conversationId: string
  parentBranchPath: string
  branchPath: string
}

const branchCreatedListeners = new Set<
  (event: ConversationBranchCreatedEvent) => void | Promise<void>
>()

export async function emitConversationBranchCreated(event: ConversationBranchCreatedEvent): Promise<void> {
  await Promise.all([...branchCreatedListeners].map((listener) => listener(event)))
}

export function onConversationBranchCreated(
  listener: (event: ConversationBranchCreatedEvent) => void | Promise<void>,
): () => void {
  branchCreatedListeners.add(listener)
  return () => branchCreatedListeners.delete(listener)
}
