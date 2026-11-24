/** 会话 Agent 模式 → 迹录工具模式（DOC/30 §2.3） */

export type AgentModeApi = {
  getConversationAgentMode?: (
    conversationId: string,
  ) => Promise<'on' | 'off'>
}

export async function isTraceToolMode(
  api: AgentModeApi,
  conversationId: string,
): Promise<boolean> {
  const cid = conversationId.trim()
  if (!cid) return false
  if (typeof api.getConversationAgentMode !== 'function') return false
  try {
    return (await api.getConversationAgentMode(cid)) === 'on'
  } catch {
    return false
  }
}
