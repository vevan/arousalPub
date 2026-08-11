import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  readHomeCharacterSort,
  readHomeCharacterSortOrder,
  readHomeConversationSort,
  readHomeConversationSortOrder,
  writeHomeCharacterSort,
  writeHomeCharacterSortOrder,
  writeHomeConversationSort,
  writeHomeConversationSortOrder,
  type HomeCharacterSort,
  type HomeConversationSort,
  type HomeSortOrder,
} from '@/utils/home-preferences'
import type { ChatListEntry } from './types'

export const SORT_ORDER_OPTIONS: HomeSortOrder[] = ['asc', 'desc']

export const CONVERSATION_SORT_OPTIONS: HomeConversationSort[] = [
  'recentChat',
  'title',
  'turnCount',
]

export const CHARACTER_SORT_OPTIONS: HomeCharacterSort[] = [
  'recentChat',
  'name',
  'usageCount',
]

export function conversationRecentChatAt(c: ChatListEntry): string {
  return c.lastChatAt?.trim() || c.updatedAt
}

function matchesConversationSearch(c: ChatListEntry, q: string): boolean {
  if (!q) return true
  if (c.title.toLowerCase().includes(q)) return true
  const userName = c.userName?.trim()
  if (userName && userName.toLowerCase().includes(q)) return true
  if (c.characterNames?.some((n) => n.toLowerCase().includes(q))) return true
  if (c.searchTags?.some((tag) => tag.toLowerCase().includes(q))) return true
  return false
}

export function useConversationListFilters(conversations: Ref<ChatListEntry[]>) {
  const { t } = useI18n()

  const searchQuery = ref('')
  const characterSearchQuery = ref('')
  const conversationSort = ref<HomeConversationSort>(readHomeConversationSort())
  const conversationSortOrder = ref<HomeSortOrder>(readHomeConversationSortOrder())
  const characterSort = ref<HomeCharacterSort>(readHomeCharacterSort())
  const characterSortOrder = ref<HomeSortOrder>(readHomeCharacterSortOrder())

  function conversationSortLabel(sort: HomeConversationSort): string {
    const keys: Record<HomeConversationSort, string> = {
      recentChat: 'home.sortRecentChat',
      title: 'home.sortTitle',
      turnCount: 'home.sortTurnCount',
    }
    return t(keys[sort])
  }

  function characterSortLabel(sort: HomeCharacterSort): string {
    const keys: Record<HomeCharacterSort, string> = {
      recentChat: 'home.sortRecentChat',
      name: 'home.sortCharacterName',
      usageCount: 'home.sortUsageCount',
    }
    return t(keys[sort])
  }

  function sortOrderLabel(order: HomeSortOrder): string {
    return order === 'asc' ? t('characters.sortAsc') : t('characters.sortDesc')
  }

  function sortOrderIcon(order: HomeSortOrder): string {
    return order === 'asc' ? 'mdi-sort-ascending' : 'mdi-sort-descending'
  }

  function setConversationSort(next: HomeConversationSort) {
    conversationSort.value = next
    writeHomeConversationSort(next)
  }

  function setCharacterSort(next: HomeCharacterSort) {
    characterSort.value = next
    writeHomeCharacterSort(next)
  }

  function setConversationSortOrder(next: HomeSortOrder) {
    conversationSortOrder.value = next
    writeHomeConversationSortOrder(next)
  }

  function setCharacterSortOrder(next: HomeSortOrder) {
    characterSortOrder.value = next
    writeHomeCharacterSortOrder(next)
  }

  function sortConversations(list: ChatListEntry[]): ChatListEntry[] {
    const out = [...list]
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
    const desc = conversationSortOrder.value === 'desc'
    out.sort((a, b) => {
      switch (conversationSort.value) {
        case 'title': {
          const ta = (a.title || '').trim()
          const tb = (b.title || '').trim()
          const cmp = collator.compare(ta, tb)
          if (cmp !== 0) return desc ? -cmp : cmp
          return conversationRecentChatAt(b).localeCompare(
            conversationRecentChatAt(a),
            'en',
          )
        }
        case 'turnCount': {
          const ca = a.activeTurnCount ?? 0
          const cb = b.activeTurnCount ?? 0
          if (ca !== cb) return desc ? cb - ca : ca - cb
          return conversationRecentChatAt(b).localeCompare(
            conversationRecentChatAt(a),
            'en',
          )
        }
        case 'recentChat':
        default: {
          const ta = conversationRecentChatAt(a)
          const tb = conversationRecentChatAt(b)
          return desc ? tb.localeCompare(ta, 'en') : ta.localeCompare(tb, 'en')
        }
      }
    })
    return out
  }

  const filteredConversations = computed(() => {
    const q = searchQuery.value.trim().toLowerCase()
    const base = !q
      ? conversations.value
      : conversations.value.filter((c) => matchesConversationSearch(c, q))
    return sortConversations(base)
  })

  function clearSearchQueries() {
    searchQuery.value = ''
    characterSearchQuery.value = ''
  }

  return {
    searchQuery,
    characterSearchQuery,
    conversationSort,
    conversationSortOrder,
    characterSort,
    characterSortOrder,
    filteredConversations,
    conversationSortLabel,
    characterSortLabel,
    sortOrderLabel,
    sortOrderIcon,
    setConversationSort,
    setCharacterSort,
    setConversationSortOrder,
    setCharacterSortOrder,
    clearSearchQueries,
  }
}
