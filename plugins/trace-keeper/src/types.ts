export interface TurnCtx {
  turn?: { turnOrdinal?: number; plugins?: unknown[] }
  listIndex?: number
}

export interface PluginHost {
  pluginKey: (key: string) => string
  t: (key: string, params?: Record<string, unknown>) => string
  session: {
    turns?: { turnOrdinal: number; plugins?: unknown[] }[]
    refreshSlotButtons?: () => void
  }
  conversation: {
    getPluginSettings: () => Promise<Record<string, unknown>>
    getPluginSettingsSnapshot: () => Record<string, unknown>
    onPluginSettingsChanged: (
      handler: (settings: Record<string, unknown>) => void,
    ) => () => void
    refresh?: () => Promise<void>
  }
  plugins: {
    getUserSettings: () => Promise<Record<string, unknown>>
  }
  lifecycle: {
    onAssistantReplyPersisted: (
      handler: (event: { turnOrdinal?: number }) => void,
    ) => () => void
  }
  registerSlotButton: (slot: string, def: Record<string, unknown>) => void
  registerStyles: (css: string) => void
  refreshSlotButtons: () => void
  ui: {
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
