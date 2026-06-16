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
  const turnDataChangedListeners = new Set<() => void>()

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

  function onTurnDataChanged(listener: () => void): () => void {
    turnDataChangedListeners.add(listener)
    return () => {
      turnDataChangedListeners.delete(listener)
    }
  }

  function emitTurnDataChanged(): void {
    for (const listener of turnDataChangedListeners) {
      try {
        listener()
      } catch {
        /* ignore plugin listener errors */
      }
    }
  }

  const generatingChangedListeners = new Set<() => void>()

  function onGeneratingChanged(listener: () => void): () => void {
    generatingChangedListeners.add(listener)
    return () => {
      generatingChangedListeners.delete(listener)
    }
  }

  function emitGeneratingChanged(): void {
    for (const listener of generatingChangedListeners) {
      try {
        listener()
      } catch {
        /* ignore plugin listener errors */
      }
    }
  }

  return {
    onAssistantReplyComplete,
    onAssistantReplyPersisted,
    onTurnDataChanged,
    onGeneratingChanged,
    emitAssistantReplyComplete,
    emitAssistantReplyPersisted,
    emitTurnDataChanged,
    emitGeneratingChanged,
  }
}
