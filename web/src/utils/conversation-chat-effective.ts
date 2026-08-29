import type { useApiKeysStore } from '@/stores/apiKeys'
import type { useConnectionStore } from '@/stores/connection'
import type { useConversationApiStore } from '@/stores/conversation-api'
import {
  mergePresetWithChatBinding,
  type ResolvedConversationChatDisplay,
} from '@/utils/conversation-api-settings'

type ConnectionStore = ReturnType<typeof useConnectionStore>
type ConversationApiStore = ReturnType<typeof useConversationApiStore>
type ApiKeysStore = ReturnType<typeof useApiKeysStore>

/** 与服务端 resolveConversationChatCall 对齐的会话有效采样显示。 */
export function resolveEffectiveConversationChatDisplay(
  conn: ConnectionStore,
  conversationApi: ConversationApiStore,
  conversationId: string,
): ResolvedConversationChatDisplay | null {
  const bindingRaw = conversationApi.bindingFor(conversationId)
  const binding =
    bindingRaw != null && bindingRaw.inheritGlobal !== true ? bindingRaw : null
  const presetId =
    binding?.apiConfigId?.trim() ||
    conn.activePresetId ||
    conn.presets[0]?.id ||
    ''
  const preset = conn.presets.find((p) => p.id === presetId) ?? conn.presets[0]
  if (!preset) return null
  return mergePresetWithChatBinding(preset, binding)
}

export function isPresetApiKeyConfigured(
  conn: ConnectionStore,
  apiKeys: ApiKeysStore,
  presetId: string,
): boolean {
  const id = presetId.trim()
  if (!id) return false
  const preset = conn.presets.find((p) => p.id === id)
  if (!preset) return false
  if (preset.keyConfigured) return true
  const keyId = preset.apiKeyId?.trim()
  if (keyId) {
    const entry = apiKeys.findById(keyId)
    if (entry?.keyConfigured) return true
  }
  return false
}

/** 会话出站就绪：有效模型非空，且绑定预设已配置 Key。 */
export function isEffectiveConversationChatReady(
  conn: ConnectionStore,
  apiKeys: ApiKeysStore,
  conversationApi: ConversationApiStore,
  conversationId: string,
): boolean {
  const effective = resolveEffectiveConversationChatDisplay(
    conn,
    conversationApi,
    conversationId,
  )
  if (!effective?.model.trim()) return false
  return isPresetApiKeyConfigured(conn, apiKeys, effective.apiPresetId)
}
