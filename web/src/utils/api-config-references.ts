/** 与服务端 api-config-references 响应对齐 */
export interface ApiConfigReference {
  kind:
    | 'conversation_api_preset'
    | 'global_feature_binding'
    | 'api_preset_api_key'
    | 'embedding_api_key'
  presetId?: string
  presetAlias?: string
  conversationId?: string
  conversationTitle?: string
  path?: string
}

export interface ApiConfigInUsePayload {
  error: string
  references?: ApiConfigReference[]
}

export function isApiConfigInUsePayload(v: unknown): v is ApiConfigInUsePayload {
  return Boolean(v && typeof v === 'object' && 'error' in v)
}
