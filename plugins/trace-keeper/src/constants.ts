export const PLUGIN_ID = 'trace-keeper'
export const DEFAULT_BUNDLE_ID = 'scene-tracker-default'
export const BLOCK_TAG = 'ex-trace-keeper'
export const MAX_STATE_BYTES = 65_536

export interface TraceBundle {
  id: string
  label: string
  sampleState: Record<string, unknown>
  template: string
  stylesheet: string
  systemPromptTemplate?: string
}

export interface TraceKeeperPayload {
  state: Record<string, unknown>
  epoch: number
  receiveId?: string
}

export interface TracePanelMeta {
  mode: 'live' | 'pinned'
  turnOrdinal?: number
  epoch: number
}
