import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 跨面板 UI 上下文（如当前对话绑定的资料库） */
export const useUiContextStore = defineStore('uiContext', () => {
  const conversationLorebookIds = ref<string[]>([])
  /** 打开资料库面板时优先聚焦的资料库 id（单次消费） */
  const pendingLorebookFocusId = ref<string | null>(null)
  /** 递增以触发 App 打开资料库对话框 */
  const openLorebooksSignal = ref(0)

  function setConversationLorebookIds(ids: string[]) {
    conversationLorebookIds.value = ids.filter(
      (id) => typeof id === 'string' && id.trim().length > 0,
    )
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

  return {
    conversationLorebookIds,
    openLorebooksSignal,
    setConversationLorebookIds,
    requestOpenLorebooksDialog,
    consumePendingLorebookFocusId,
  }
})
