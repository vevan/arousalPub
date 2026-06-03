/** 从 `/chat/:id` 返回 `/` 时恢复对话列表视图（见 ConversationListView） */
export const HOME_RETURN_FROM_CHAT_KEY = 'arousal-home-return-from-chat'

export function markHomeReturnFromChat(): void {
  try {
    sessionStorage.setItem(HOME_RETURN_FROM_CHAT_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function consumeHomeReturnFromChat(): boolean {
  try {
    if (sessionStorage.getItem(HOME_RETURN_FROM_CHAT_KEY) === '1') {
      sessionStorage.removeItem(HOME_RETURN_FROM_CHAT_KEY)
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}
