export const PLUGIN_ID = 'trace-keeper'
export const DEFAULT_BUNDLE_ID = 'scene-tracker-default'
export const BLOCK_TAG = 'ex-trace-keeper'
export const MAX_STATE_BYTES = 65_536

export interface TraceBundle {
  id: string
  label: string
  sampleState: Record<string, unknown>
  /** 关闭 JSON 校验且 sampleStateJson 无法解析时，原样注入提示词 */
  sampleStatePromptText?: string
  template: string
  stylesheet: string
  /** Together 注入 assistant 前 system */
  systemPromptTemplate?: string
  /** Separate 补生成：对话窗口之后的 system */
  separateSystemPromptTemplate?: string
}

export interface TraceKeeperPayload {
  state: Record<string, unknown>
  epoch: number
  receiveId?: string
}

export interface TracePanelMeta {
  mode: 'live' | 'pinned'
  turnOrdinal?: number
  segmentIndex?: number
  receiveId?: string
  speakerCharacterId?: string
  epoch: number
}
