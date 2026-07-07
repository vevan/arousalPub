export interface TurnCtx {
  turn?: {
    turnOrdinal?: number
    plugins?: unknown[]
    activeReceiveIndex?: number
    receives?: { id?: string; content?: string }[]
  }
  listIndex?: number
}

export interface PluginHost {
  pluginKey: (key: string) => string
  t: (key: string, params?: Record<string, unknown>) => string
  session: {
    turns?: {
      turnOrdinal: number
      plugins?: unknown[]
      activeReceiveIndex?: number
      receives?: { id?: string; content?: string }[]
    }[]
    loading?: boolean | { value?: boolean }
    regeneratingTurnOrdinal?: number | null | { value?: number | null }
    refreshSlotButtons?: () => void
    writeChatPromptSnapshot?: boolean | { value: boolean }
  }
  conversation: {
    getId?: () => string
    getPluginSettings: () => Promise<Record<string, unknown>>
    getPluginSettingsSnapshot: () => Record<string, unknown>
    onPluginSettingsChanged: (
      handler: (settings: Record<string, unknown>) => void,
    ) => () => void
    refresh?: () => Promise<void>
  }
  plugins: {
    getUserSettings: () => Promise<Record<string, unknown>>
    onUserSettingsChanged?: (
      handler: (settings: Record<string, unknown>) => void,
    ) => () => void
  }
  lifecycle: {
    onAssistantReplyPersisted: (
      handler: (event: { turnOrdinal?: number }) => void,
    ) => () => void
    onTurnDataChanged?: (handler: () => void) => () => void
    onGeneratingChanged?: (handler: () => void) => () => void
  }
  registerSlotButton: (slot: string, def: Record<string, unknown>) => void
  registerStyles: (css: string) => void
  refreshSlotButtons: () => void
  registerFormDialog?: (
    pluginId: string,
    def: Record<string, unknown>,
    dialogId?: string,
  ) => void
  openFormDialog?: (
    pluginId: string,
    model: Record<string, unknown>,
    dialogId?: string,
  ) => void
  plugin: {
    runAction(
      action: string,
      body: Record<string, unknown>,
    ): Promise<Record<string, unknown>>
  }
  ui: {
    toast?: (message: string, opts?: { color?: string }) => void
    panel: {
      register: (opts: Record<string, unknown>) => void
      setHtml: (
        placement: string,
        pluginId: string,
        html: string,
        opts?: { revision?: number },
      ) => void
      open: (placement: string, pluginId?: string) => void
      onEvent: (
        placement: string,
        pluginId: string,
        handlers: Record<string, unknown>,
      ) => void
    }
  }
}
