import type {
  AssistantReplyCompleteEvent,
  AssistantReplyPersistedEvent,
} from './types.js'

export function createReplyEventHub() {
  const assistantReplyCompleteListeners = new Set<
    (event: AssistantReplyCompleteEvent) => void
  >()
  const assistantReplyPersistedListeners = new Set<
    (event: AssistantReplyPersistedEvent) => void
  >()

  function onAssistantReplyPersisted(
    listener: (event: AssistantReplyPersistedEvent) => void,
  ): () => void {
    assistantReplyPersistedListeners.add(listener)
    return () => {
      assistantReplyPersistedListeners.delete(listener)
    }
  }

  function emitAssistantReplyPersisted(event: AssistantReplyPersistedEvent): void {
    for (const listener of assistantReplyPersistedListeners) {
      try {
        listener(event)
      } catch {
        /* ignore plugin listener errors */
      }
    }
  }

  function onAssistantReplyComplete(
    listener: (event: AssistantReplyCompleteEvent) => void,
  ): () => void {
    assistantReplyCompleteListeners.add(listener)
    return () => {
      assistantReplyCompleteListeners.delete(listener)
    }
  }

  function emitAssistantReplyComplete(event: AssistantReplyCompleteEvent): void {
    for (const listener of assistantReplyCompleteListeners) {
      try {
        listener(event)
      } catch {
        /* ignore plugin listener errors */
      }
    }
  }

  return {
    onAssistantReplyComplete,
    onAssistantReplyPersisted,
    emitAssistantReplyComplete,
    emitAssistantReplyPersisted,
  }
}
