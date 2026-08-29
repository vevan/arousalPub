import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ConversationChatBinding } from '@/utils/conversation-api-settings'

function cloneBinding(
  binding: ConversationChatBinding | null,
): ConversationChatBinding | null {
  return binding ? { ...binding, drySequenceBreakers: binding.drySequenceBreakers ? [...binding.drySequenceBreakers] : undefined } : null
}

function readChatBinding(index: Record<string, unknown>): ConversationChatBinding | null {
  const raw = (index.apiPreset as { chat?: unknown } | undefined)?.chat
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? cloneBinding(raw as ConversationChatBinding)
    : null
}

/** 当前打开对话的 API 参数唯一客户端状态源。 */
export const useConversationApiStore = defineStore('conversation-api', () => {
  const conversationId = ref('')
  const chatBinding = ref<ConversationChatBinding | null>(null)
  const chatUseGlobal = computed(
    () => chatBinding.value == null || chatBinding.value.inheritGlobal === true,
  )

  function syncFromIndex(id: string, index: Record<string, unknown>): void {
    if (!id.trim()) return
    conversationId.value = id
    chatBinding.value = readChatBinding(index)
  }

  function setChatBinding(id: string, binding: ConversationChatBinding | null): void {
    if (!id.trim()) return
    conversationId.value = id
    chatBinding.value = cloneBinding(binding)
  }

  function bindingFor(id: string): ConversationChatBinding | null | undefined {
    return conversationId.value === id ? chatBinding.value : undefined
  }

  return {
    conversationId,
    chatBinding,
    chatUseGlobal,
    syncFromIndex,
    setChatBinding,
    bindingFor,
  }
})
