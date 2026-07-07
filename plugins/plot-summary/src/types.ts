export interface PluginHost {
  pluginKey: (key: string) => string
  t: (key: string, params?: Record<string, unknown>) => string
  session: {
    conversationWriteLocked: boolean
    loading: boolean
    regeneratingTurnOrdinal: number | null
    turns?: { turnOrdinal?: number }[]
    writeChatPromptSnapshot?: boolean | { value: boolean }
  }
  conversation: {
    getPluginSettings: () => Promise<Record<string, unknown>>
    getPluginSettingsSnapshot: () => Record<string, unknown>
    onPluginSettingsChanged: (
      handler: (settings: Record<string, unknown>) => void,
    ) => () => void
    patchPluginSettings: (partial: Record<string, unknown>) => Promise<Record<string, unknown>>
    setPluginHold?: (hold: boolean) => void
  }
  lorebook: {
    get: (id: string) => Promise<{
      name?: string
      groups?: { id: string; order: number }[]
      entries?: {
        id: string
        groupId?: string
        title?: string
        content?: string
        order?: number
        createdAt?: string
      }[]
    }>
    createEntry: (lorebookId: string, body: Record<string, unknown>) => Promise<{ id: string }>
    createEntriesBatch?: (
      lorebookId: string,
      entries: Record<string, unknown>[],
    ) => Promise<{ id: string }[]>
    patchEntry: (lorebookId: string, entryId: string, body: Record<string, unknown>) => Promise<unknown>
    normalizeEntryRefs: (req: {
      lorebookId: string
      entryIds: Record<string, string>
      validKeys: string[]
    }) => Promise<Record<string, string>>
    applyOrder: (
      lorebookId: string,
      req: {
        scope?: 'full' | 'partial'
        groupIds?: string[]
        entriesByGroup?: Record<string, string[]>
      },
    ) => Promise<{ ok: true; changed: number }>
    ensure: (req?: { nameTemplate?: string }) => Promise<{ id: string; name: string; created: boolean }>
  }
  plugin: {
    prepareContextBlocks: (req: {
      blocks: import('../../../shared/plugin-context-blocks.js').ContextBlockSpec[]
    }) => Promise<import('../../../shared/plugin-context-blocks.js').PluginContextBlocksSuccess>
    assemblePluginPrompt: (
      req: Omit<
        import('../../../shared/plugin-context-blocks.js').AssemblePluginPromptRequest,
        'conversationId'
      >,
    ) => Promise<import('../../../shared/plugin-context-blocks.js').AssemblePluginPromptSuccess>
    completeWithContext: (
      req: Omit<
        import('../../../shared/plugin-context-blocks.js').CompleteWithContextRequest,
        'conversationId'
      >,
    ) => Promise<import('../../../shared/plugin-context-blocks.js').CompleteWithContextSuccess>
  }
  plugins: { getUserSettings: () => Promise<Record<string, unknown>> }
  macros?: {
    expand: (
      text: string,
      opts?: { apiConfigId?: string; toTurn?: number; persistVars?: boolean },
    ) => Promise<string>
  }
  token?: {
    preflightComplete: (req: {
      apiConfigId?: string
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    }) => Promise<{ ok: boolean; promptTokens: number; budget: number; code?: string }>
  }
  ui: {
    toast: (msg: string, opts?: { color?: string }) => void
    progress: (opts: Record<string, unknown>) => void
    clearProgress: () => void
    openFormDialog: (
      pluginId: string,
      model: Record<string, unknown>,
      dialogId?: string,
      opts?: { titleParams?: Record<string, unknown> },
    ) => void
  }
  lifecycle: {
    onAssistantReplyPersisted: (handler: (event: {
      turnOrdinal?: number
      isFirstTurn?: boolean
    }) => void) => () => void
  }
  registerSlotButton: (slot: string, def: Record<string, unknown>) => void
  registerFormDialog: (pluginId: string, def: Record<string, unknown>, dialogId?: string) => void
  openFormDialog: (
    pluginId: string,
    model: Record<string, unknown>,
    dialogId?: string,
    opts?: { titleParams?: Record<string, unknown> },
  ) => void
  refreshSlotButtons: () => void
  registerStyles: (css: string) => void
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
  previousSummariesLimit: number
  entrySortMode: 'manual' | 'auto-turn-suffix'
  defaultEntryTriggerMode: string
  systemPromptTemplate: string
  autoSummarizeEnabled: boolean
  nextBlockStart: number
  lastSummarizedEnd?: number
  sidecarEntryIds: Record<string, string>
  sidecars: SidecarConfig[]
  autoSidecarIds: string[]
  /** 手动摘要弹窗上次勾选：memory + sidecar:id */
  manualSummarizeTasks: string[]
  autoSummarizeDefaultEnabled: boolean
  targetLorebookMode: 'manual' | 'auto'
  autoLorebookNameTemplate: string
  regexRuleIds: string[]
  regexApplyAllTurns: boolean
}

export type SummarizeTask =
  | { kind: 'memory' }
  | { kind: 'sidecar'; sidecar: SidecarConfig }
