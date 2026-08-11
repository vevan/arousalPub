import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { characterImageUrl } from '@/utils/authenticated-media-url'
import { generateConversationId } from '@/utils/conversation-id'
import { allocateShortId } from '@/utils/short-id'
import { initialMultiBotGroupChatSettings } from '@/utils/group-chat-settings'
import { pickDefaultLorebookIds, fetchLorebookPickerItems } from '@/utils/default-lorebook'
import { markHomeReturnFromChat } from '@/utils/home-navigation'
import { useAuthStore } from '@/stores/auth'
import type {
  CharacterPickerItem,
  CharacterStoredDocument,
  LorebookPickerItem,
} from './types'

export function useCreateConversation() {
  const { t } = useI18n()
  const router = useRouter()
  const auth = useAuthStore()

  const createOpen = ref(false)
  const creating = ref(false)
  const createErrorText = ref('')
  const createTitleDraft = ref('')

  const charItems = ref<CharacterPickerItem[]>([])
  const charItemsLoading = ref(false)
  const selectedUserCard = ref<CharacterPickerItem | null>(null)
  const selectedCharacterCards = ref<(CharacterPickerItem | null)[]>([null])
  const pickerOpen = ref(false)
  const pickerTarget = ref<
    { kind: 'user' } | { kind: 'character'; index: number } | null
  >(null)
  const userPickerOnlyMarked = ref(false)
  const characterPickerExcludeUser = ref(false)

  const lorebookItems = ref<LorebookPickerItem[]>([])
  const lorebookItemsLoading = ref(false)
  const selectedLorebookIds = ref<string[]>([])

  const displayedCharItems = computed(() => {
    const target = pickerTarget.value
    if (!target) return charItems.value
    if (target.kind === 'user') {
      if (userPickerOnlyMarked.value) {
        return charItems.value.filter((x) => x.isUser)
      }
      return [...charItems.value].sort((a, b) => {
        const au = a.isUser ? 0 : 1
        const bu = b.isUser ? 0 : 1
        if (au !== bu) return au - bu
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })
    }
    if (characterPickerExcludeUser.value) {
      return charItems.value.filter((x) => !x.isUser)
    }
    return charItems.value
  })

  const selectedCharacters = computed(() =>
    selectedCharacterCards.value.filter((c): c is CharacterPickerItem => Boolean(c)),
  )

  const canStartCreate = computed(
    () =>
      Boolean(
        selectedUserCard.value &&
          selectedCharacterCards.value[0] &&
          createTitleDraft.value.trim(),
      ) && !creating.value,
  )

  function characterImage(id: string) {
    return (
      characterImageUrl(auth.user?.id ?? auth.defaultUserId, id, { size: 'm' }) ??
      ''
    )
  }

  async function fetchCharacterDetail(
    id: string,
  ): Promise<CharacterStoredDocument | null> {
    try {
      const res = await fetch(`/api/characters/${id}`)
      if (!res.ok) return null
      return (await res.json()) as CharacterStoredDocument
    } catch {
      return null
    }
  }

  function stringField(card: Record<string, unknown> | undefined, key: string): string {
    const v = card?.[key]
    return typeof v === 'string' ? v.trim() : ''
  }

  function collectOpeningGreetings(
    card: Record<string, unknown> | undefined,
  ): string[] {
    const out: string[] = []
    const first = stringField(card, 'first_mes')
    if (first) out.push(first)
    const alt = card?.alternate_greetings
    if (Array.isArray(alt)) {
      for (const raw of alt) {
        const text = typeof raw === 'string' ? raw.trim() : ''
        if (text) out.push(text)
      }
    }
    return out
  }

  async function loadLorebookItems() {
    if (lorebookItemsLoading.value) return
    lorebookItemsLoading.value = true
    try {
      lorebookItems.value = await fetchLorebookPickerItems()
      if (createOpen.value && selectedLorebookIds.value.length === 0) {
        selectedLorebookIds.value = pickDefaultLorebookIds(lorebookItems.value)
      }
    } finally {
      lorebookItemsLoading.value = false
    }
  }

  async function loadCharacterItems() {
    if (charItemsLoading.value) return
    charItemsLoading.value = true
    try {
      const res = await fetch('/api/characters?limit=200&offset=0&kind=all')
      if (!res.ok) return
      const j = (await res.json()) as {
        items?: {
          id?: string
          name?: string
          summary?: string
          isUser?: boolean
        }[]
      }
      charItems.value = (j.items ?? [])
        .filter((x) => typeof x.id === 'string' && x.id.trim())
        .map((x) => ({
          id: x.id as string,
          name:
            typeof x.name === 'string' && x.name.trim()
              ? x.name.trim()
              : (x.id as string),
          summary: typeof x.summary === 'string' ? x.summary : '',
          isUser: x.isUser === true,
        }))
    } finally {
      charItemsLoading.value = false
    }
  }

  function openCreateDialog() {
    createErrorText.value = ''
    createTitleDraft.value = ''
    selectedUserCard.value = null
    selectedCharacterCards.value = [null]
    selectedLorebookIds.value = pickDefaultLorebookIds(lorebookItems.value)
    createOpen.value = true
    void loadCharacterItems()
    void loadLorebookItems()
  }

  function closeCreateDialog() {
    createOpen.value = false
    pickerOpen.value = false
    pickerTarget.value = null
    userPickerOnlyMarked.value = false
    characterPickerExcludeUser.value = false
    charItems.value = []
  }

  function openUserPicker() {
    pickerTarget.value = { kind: 'user' }
    userPickerOnlyMarked.value = true
    pickerOpen.value = true
    void loadCharacterItems()
  }

  function openCharacterPicker(index: number) {
    pickerTarget.value = { kind: 'character', index }
    characterPickerExcludeUser.value = true
    pickerOpen.value = true
    void loadCharacterItems()
  }

  function selectCharacter(item: CharacterPickerItem) {
    const target = pickerTarget.value
    if (!target) return
    if (target.kind === 'user') {
      selectedUserCard.value = item
    } else {
      selectedCharacterCards.value[target.index] = item
      if (target.index === 0 && !createTitleDraft.value.trim()) {
        createTitleDraft.value = item.name
      }
    }
    pickerOpen.value = false
    pickerTarget.value = null
  }

  function addCharacterSlot() {
    selectedCharacterCards.value.push(null)
  }

  function removeCharacterSlot(index: number) {
    if (selectedCharacterCards.value.length <= 1) {
      selectedCharacterCards.value = [null]
      return
    }
    selectedCharacterCards.value.splice(index, 1)
  }

  async function createAndOpen(loading: boolean) {
    if (creating.value || loading || !canStartCreate.value) return
    creating.value = true
    const id = generateConversationId()
    const userCard = selectedUserCard.value
    const characters = selectedCharacters.value
    const mainCharacter = characters[0]
    createErrorText.value = ''
    if (!userCard || !mainCharacter) {
      creating.value = false
      return
    }
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: id,
          title: createTitleDraft.value.trim(),
        }),
      })
      if (!res.ok) {
        createErrorText.value = t('conversationList.createFailed')
        return
      }
      const characterIds = characters.map((c) => c.id)
      const patchBody: Record<string, unknown> = {
        userCharacterId: userCard.id,
        userName: userCard.name,
        characterIds,
        lorebookIds: [...selectedLorebookIds.value],
      }
      if (characterIds.length >= 2) {
        patchBody.groupChat = initialMultiBotGroupChatSettings(characterIds)
      }
      const patch = await fetch(`/api/chat/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      })
      if (!patch.ok) {
        createErrorText.value = t('conversationList.createFailed')
        return
      }
      const mainDoc = await fetchCharacterDetail(mainCharacter.id)
      const greetings = collectOpeningGreetings(mainDoc?.card)
      if (greetings.length > 0) {
        const used = new Set<string>()
        const opening = await fetch(`/api/chat/conversations/${id}/opening`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receives: greetings.map((content) => ({
              id: allocateShortId(used),
              content,
            })),
            activeReceiveIndex: 0,
          }),
        })
        if (!opening.ok) {
          createErrorText.value = t('conversationList.createFailed')
          return
        }
      }
      closeCreateDialog()
      markHomeReturnFromChat()
      await router.push({ name: 'chat', params: { conversationId: id } })
    } catch {
      createErrorText.value = t('conversationList.createFailed')
    } finally {
      creating.value = false
    }
  }

  return {
    createOpen,
    creating,
    createErrorText,
    createTitleDraft,
    charItemsLoading,
    selectedUserCard,
    selectedCharacterCards,
    pickerOpen,
    pickerTarget,
    userPickerOnlyMarked,
    characterPickerExcludeUser,
    lorebookItems,
    lorebookItemsLoading,
    selectedLorebookIds,
    displayedCharItems,
    canStartCreate,
    characterImage,
    openCreateDialog,
    closeCreateDialog,
    openUserPicker,
    openCharacterPicker,
    selectCharacter,
    addCharacterSlot,
    removeCharacterSlot,
    createAndOpen,
  }
}
