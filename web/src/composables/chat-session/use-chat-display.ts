import { characterImageUrl } from '@/utils/chat-turn-display'
import {
  groupChatMemberColor,
  type GroupChatSettings,
} from '@/utils/group-chat-settings'
import { characterNameById } from '@/utils/group-chat-turn'
import { computed, ref, watch } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'

export function useChatDisplay(opts: {
  conversationUserName?: string | null
  getUserCharacterId: () => string | null | undefined
  getCharacterIds: () => string[] | null | undefined
  getBoundDisplayNames?: () => readonly string[] | null | undefined
  getAuthUserId: () => string | null | undefined
  getConnAlias: () => string
  getConnModel: () => string
  isGroupChatEnabled?: () => boolean
  getGroupChatSettings?: () => GroupChatSettings | null | undefined
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

  function avatarLetterFromName(name: string): string {
    const ch = name.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '').charAt(0)
    return ch ? ch.toUpperCase() : 'N'
  }

  function resolveSpeakerCharacterId(speakerCharacterId?: string): string {
    const id = speakerCharacterId?.trim()
    if (id) return id
    // 群聊未知 speaker 时不回退到 characterIds[0]，避免掷骰非首位时短暂错显
    if (opts.isGroupChatEnabled?.()) return ''
    const charIds = opts.getCharacterIds() ?? []
    return charIds[0]?.trim() ?? ''
  }

  function assistantRoleNameForSpeaker(speakerCharacterId?: string): string {
    const raw = speakerCharacterId?.trim()
    if (!raw && opts.isGroupChatEnabled?.()) {
      return assistantRoleName.value
    }
    const id = resolveSpeakerCharacterId(speakerCharacterId)
    const charIds = opts.getCharacterIds() ?? []
    const names = opts.getBoundDisplayNames?.() ?? []
    if (id && charIds.length > 0) {
      const bound = characterNameById(id, [...charIds], [...names])
      if (bound.trim()) return bound.trim()
    }
    return assistantRoleName.value
  }

  function assistantAvatarUrlForSpeaker(speakerCharacterId?: string): string | null {
    const raw = speakerCharacterId?.trim()
    if (!raw && opts.isGroupChatEnabled?.()) return null
    const id = resolveSpeakerCharacterId(speakerCharacterId)
    if (!id) return turnAvatarUrls.value.assistant
    return characterImageUrl(opts.getAuthUserId(), id, { size: 's' })
  }

  function assistantAvatarLetterForSpeaker(speakerCharacterId?: string): string {
    return avatarLetterFromName(assistantRoleNameForSpeaker(speakerCharacterId))
  }

  /** 群聊开启且成员有合法 color 时返回 `#rrggbb`，否则 null（走默认 primary） */
  function speakerAccentColor(speakerCharacterId?: string): string | null {
    if (!opts.isGroupChatEnabled?.()) return null
    const settings = opts.getGroupChatSettings?.()
    if (!settings) return null
    const id = resolveSpeakerCharacterId(speakerCharacterId)
    if (!id) return null
    return groupChatMemberColor(id, settings)
  }

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
        opts.getAuthUserId(),
        opts.getUserCharacterId(),
        opts.getCharacterIds(),
      ] as const,
    ([ownerUserId, userId, charIds]) => {
      const primaryId = Array.isArray(charIds) ? charIds[0] : undefined
      turnAvatarUrls.value = {
        user: characterImageUrl(ownerUserId, userId, { size: 's' }),
        assistant: characterImageUrl(ownerUserId, primaryId, { size: 's' }),
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
    assistantRoleNameForSpeaker,
    assistantAvatarUrlForSpeaker,
    assistantAvatarLetterForSpeaker,
    speakerAccentColor,
  }
}
