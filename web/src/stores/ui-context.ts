import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 跨面板 UI 上下文（如当前对话绑定的资料库 / 提示词预设） */
export const useUiContextStore = defineStore('uiContext', () => {
  const conversationLorebookIds = ref<string[]>([])
  /** 当前对话生效的提示词预设 id（显式绑定或全局激活） */
  const conversationPromptPresetId = ref<string | null>(null)
  /** 打开资料库面板时优先聚焦的资料库 id（单次消费） */
  const pendingLorebookFocusId = ref<string | null>(null)
  /** 打开提示词面板时优先聚焦的预设 id（单次消费） */
  const pendingPromptFocusPresetId = ref<string | null>(null)
  /** 递增以触发 App 打开资料库对话框 */
  const openLorebooksSignal = ref(0)
  /** 递增以触发 App 打开提示词对话框 */
  const openPromptsSignal = ref(0)

  function setConversationLorebookIds(ids: string[]) {
    conversationLorebookIds.value = ids.filter(
      (id) => typeof id === 'string' && id.trim().length > 0,
    )
  }

  function setConversationPromptPresetId(id: string | null | undefined) {
    conversationPromptPresetId.value =
      typeof id === 'string' && id.trim() ? id.trim() : null
  }

  function requestOpenLorebooksDialog(focusLorebookId?: string | null) {
    pendingLorebookFocusId.value =
      typeof focusLorebookId === 'string' && focusLorebookId.trim()
        ? focusLorebookId.trim()
        : null
    openLorebooksSignal.value += 1
  }

  function consumePendingLorebookFocusId(): string | null {
    const id = pendingLorebookFocusId.value
    pendingLorebookFocusId.value = null
    return id
  }

  function requestOpenPromptsDialog(focusPresetId?: string | null) {
    pendingPromptFocusPresetId.value =
      typeof focusPresetId === 'string' && focusPresetId.trim()
        ? focusPresetId.trim()
        : null
    openPromptsSignal.value += 1
  }

  function consumePendingPromptFocusPresetId(): string | null {
    const id = pendingPromptFocusPresetId.value
    pendingPromptFocusPresetId.value = null
    return id
  }

  function clearSessionData(): void {
    conversationLorebookIds.value = []
    conversationPromptPresetId.value = null
    pendingLorebookFocusId.value = null
    pendingPromptFocusPresetId.value = null
    openLorebooksSignal.value = 0
    openPromptsSignal.value = 0
  }

  return {
    conversationLorebookIds,
    conversationPromptPresetId,
    openLorebooksSignal,
    openPromptsSignal,
    setConversationLorebookIds,
    setConversationPromptPresetId,
    requestOpenLorebooksDialog,
    requestOpenPromptsDialog,
    consumePendingLorebookFocusId,
    consumePendingPromptFocusPresetId,
    clearSessionData,
  }
})
