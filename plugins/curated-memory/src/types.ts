export interface PluginHost {
  pluginKey: (key: string) => string
  t: (key: string, params?: Record<string, unknown>) => string
  session: {
    conversationWriteLocked: boolean
    loading: boolean
    regeneratingTurnOrdinal: number | null
    turns?: { turnOrdinal?: number }[]
  }
  conversation: {
    getPluginSettings: () => Promise<Record<string, unknown>>
    patchPluginSettings: (partial: Record<string, unknown>) => Promise<Record<string, unknown>>
    setPluginHold?: (hold: boolean) => void
  }
  lorebook: {
    get: (id: string) => Promise<{ entries?: { id: string }[] }>
    createEntry: (lorebookId: string, body: Record<string, unknown>) => Promise<{ id: string }>
    patchEntry: (lorebookId: string, entryId: string, body: Record<string, unknown>) => Promise<unknown>
    normalizeEntryRefs: (req: {
      lorebookId: string
      entryIds: Record<string, string>
      validKeys: string[]
    }) => Promise<Record<string, string>>
  }
  plugin: {
    prepareContext: (req: {
      fromTurn: number
      toTurn: number
      targetLorebookId: string
    }) => Promise<{ userContent: string; meta: { userDisplayName: string; assistantDisplayName: string } }>
    completeDraft: (req: {
      apiConfigId: string
      kind: 'memory' | 'sidecar'
      userContent: string
      systemPromptTemplate: string
      fromTurn?: number
      toTurn?: number
      titleFormat?: string
      sidecarName?: string
    }) => Promise<{ draft: { title: string; content: string; keywords: string[] } }>
  }
  plugins: { getUserSettings: () => Promise<Record<string, unknown>> }
  ui: {
    toast: (msg: string, opts?: { color?: string }) => void
    progress: (opts: Record<string, unknown>) => void
    clearProgress: () => void
    openFormDialog: (pluginId: string, model: Record<string, unknown>, dialogId?: string) => void
  }
  lifecycle: {
    onAssistantReplyPersisted: (handler: (event: {
      turnOrdinal?: number
      isFirstTurn?: boolean
    }) => void) => () => void
  }
  registerSlotButton: (slot: string, def: Record<string, unknown>) => void
  registerFormDialog: (pluginId: string, def: Record<string, unknown>, dialogId?: string) => void
  openFormDialog: (pluginId: string, model: Record<string, unknown>, dialogId?: string) => void
  refreshSlotButtons: () => void
}

export interface SidecarConfig {
  id: string
  name: string
  enabled: boolean
  systemPromptTemplate: string
  priority: number
  triggerMode: 'keyword' | 'vector' | 'constant'
}

export interface MergedSettings {
  global: Record<string, unknown>
  conv: Record<string, unknown>
  apiConfigId: string
  targetLorebookId: string
  blockTurns: number
  bufferTurns: number
  titleFormat: string
  defaultEntryTriggerMode: string
  systemPromptTemplate: string
  memorybookEnabled: boolean
  nextBlockStart: number
  lastSummarizedEnd?: number
  sidecarEntryIds: Record<string, string>
  sidecars: SidecarConfig[]
  autoSidecarIds: string[]
  memorybookDefaultEnabled: boolean
}

export type SummarizeTask =
  | { kind: 'memory' }
  | { kind: 'sidecar'; sidecar: SidecarConfig }
