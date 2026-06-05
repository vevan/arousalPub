import { characterImageUrl } from '@/utils/chat-turn-display'
import { computed, ref, watch } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'

export function useChatDisplay(opts: {
  conversationUserName?: string | null
  getUserCharacterId: () => string | null | undefined
  getCharacterIds: () => string[] | null | undefined
  getAuthToken: () => string | null | undefined
  getConnAlias: () => string
  getConnModel: () => string
  t: ComposerTranslation
}) {
  const assistantDisplayName = ref('')

  const userDisplayName = computed(() => {
    const n = opts.conversationUserName?.trim()
    return n || opts.t('chat.userBrand')
  })

  const assistantRoleName = computed(() => {
    const n = assistantDisplayName.value.trim()
    return n || opts.t('chat.assistantBrand')
  })

  const userAvatarLetter = computed(() => {
    const m = userDisplayName.value
    const ch = m.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '').charAt(0)
    return ch ? ch.toUpperCase() : 'Y'
  })

  const assistantAvatarLetter = computed(() => {
    const m =
      assistantRoleName.value ||
      opts.getConnAlias().trim() ||
      opts.getConnModel().trim()
    if (!m) return 'N'
    const ch = m.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '').charAt(0)
    return ch ? ch.toUpperCase() : 'N'
  })

  const turnAvatarUrls = ref<Record<'user' | 'assistant', string | null>>({
    user: null,
    assistant: null,
  })

  async function loadPrimaryAssistantName(id: string | null | undefined) {
    const clean = typeof id === 'string' ? id.trim() : ''
    assistantDisplayName.value = ''
    if (!clean) return
    try {
      const res = await fetch(`/api/characters/${clean}`)
      if (!res.ok) return
      const doc = (await res.json()) as { card?: Record<string, unknown> }
      const name = doc.card?.name
      assistantDisplayName.value =
        typeof name === 'string' && name.trim() ? name.trim() : ''
    } catch {
      /* 卡可能已删除；回退到默认助手名 */
    }
  }

  watch(
    () =>
      [
        opts.getUserCharacterId(),
        opts.getCharacterIds(),
        opts.getAuthToken(),
      ] as const,
    ([userId, charIds]) => {
      const primaryId = Array.isArray(charIds) ? charIds[0] : undefined
      turnAvatarUrls.value = {
        user: characterImageUrl(userId),
        assistant: characterImageUrl(primaryId),
      }
      void loadPrimaryAssistantName(primaryId)
    },
    { immediate: true, deep: true },
  )

  return {
    turnAvatarUrls,
    userDisplayName,
    assistantRoleName,
    userAvatarLetter,
    assistantAvatarLetter,
  }
}
