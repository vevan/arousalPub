import type { ConversationMeta } from '@/plugins/types'
import { apiFetch } from '@/utils/api-fetch'

export async function fetchConversationMeta(
  conversationId: string,
  names: { userDisplayName: string; assistantDisplayName: string },
): Promise<ConversationMeta> {
  let title = ''
  let characterIds: string[] = []
  let userCharacterId: string | null = null
  try {
    const res = await apiFetch(`/api/chat/conversations/${conversationId}`)
    if (res.ok) {
      const idx = (await res.json()) as Record<string, unknown>
      title = typeof idx.title === 'string' ? idx.title : ''
      if (Array.isArray(idx.characterIds)) {
        characterIds = idx.characterIds.filter(
          (x): x is string => typeof x === 'string' && x.trim().length > 0,
        )
      }
      const uc = idx.userCharacterId
      userCharacterId =
        typeof uc === 'string' && uc.trim() ? uc.trim() : null
    }
  } catch {
    /* 标题等元数据缺失时仍返回名称与 id */
  }
  return {
    conversationId,
    title,
    userDisplayName: names.userDisplayName,
    assistantDisplayName: names.assistantDisplayName,
    exportedAt: new Date().toISOString(),
    characterIds,
    userCharacterId,
  }
}
