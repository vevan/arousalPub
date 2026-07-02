export type HomeListMode = 'conversations' | 'characters'
export type HomeCharacterSource = 'usedInChats' | 'allLibrary'

export type HomeConversationSort = 'recentChat' | 'title' | 'turnCount'
export type HomeCharacterSort = 'recentChat' | 'name' | 'usageCount'
export type HomeSortOrder = 'asc' | 'desc'

export const HOME_LIST_MODE_STORAGE_KEY = 'arousal-home-list-mode-default'
export const HOME_CHARACTER_SOURCE_STORAGE_KEY =
  'arousal-home-character-source-default'
export const HOME_CONVERSATION_SORT_STORAGE_KEY =
  'arousal-home-conversation-sort'
export const HOME_CHARACTER_SORT_STORAGE_KEY = 'arousal-home-character-sort'
export const HOME_CONVERSATION_SORT_ORDER_STORAGE_KEY =
  'arousal-home-conversation-sort-order'
export const HOME_CHARACTER_SORT_ORDER_STORAGE_KEY =
  'arousal-home-character-sort-order'

const HOME_LIST_MODES: HomeListMode[] = ['conversations', 'characters']
const HOME_CHARACTER_SOURCES: HomeCharacterSource[] = [
  'usedInChats',
  'allLibrary',
]
const HOME_CONVERSATION_SORTS: HomeConversationSort[] = [
  'recentChat',
  'title',
  'turnCount',
]
const HOME_CHARACTER_SORTS: HomeCharacterSort[] = [
  'recentChat',
  'name',
  'usageCount',
]

export function normalizeHomeListMode(raw: unknown): HomeListMode {
  if (typeof raw === 'string' && HOME_LIST_MODES.includes(raw as HomeListMode)) {
    return raw as HomeListMode
  }
  return 'conversations'
}

export function normalizeHomeCharacterSource(
  raw: unknown,
): HomeCharacterSource {
  if (
    typeof raw === 'string' &&
    HOME_CHARACTER_SOURCES.includes(raw as HomeCharacterSource)
  ) {
    return raw as HomeCharacterSource
  }
  return 'usedInChats'
}

export function readHomeListModeDefault(): HomeListMode {
  try {
    return normalizeHomeListMode(
      localStorage.getItem(HOME_LIST_MODE_STORAGE_KEY),
    )
  } catch {
    return 'conversations'
  }
}

export function writeHomeListModeDefault(mode: HomeListMode): void {
  try {
    localStorage.setItem(HOME_LIST_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function readHomeCharacterSourceDefault(): HomeCharacterSource {
  try {
    return normalizeHomeCharacterSource(
      localStorage.getItem(HOME_CHARACTER_SOURCE_STORAGE_KEY),
    )
  } catch {
    return 'usedInChats'
  }
}

export function writeHomeCharacterSourceDefault(
  source: HomeCharacterSource,
): void {
  try {
    localStorage.setItem(HOME_CHARACTER_SOURCE_STORAGE_KEY, source)
  } catch {
    /* ignore */
  }
}

export function normalizeHomeConversationSort(
  raw: unknown,
): HomeConversationSort {
  if (raw === 'updatedAt') return 'recentChat'
  if (
    typeof raw === 'string' &&
    HOME_CONVERSATION_SORTS.includes(raw as HomeConversationSort)
  ) {
    return raw as HomeConversationSort
  }
  return 'recentChat'
}

export function normalizeHomeCharacterSort(raw: unknown): HomeCharacterSort {
  if (raw === 'recentUpdate') return 'recentChat'
  if (
    typeof raw === 'string' &&
    HOME_CHARACTER_SORTS.includes(raw as HomeCharacterSort)
  ) {
    return raw as HomeCharacterSort
  }
  return 'recentChat'
}

export function readHomeConversationSort(): HomeConversationSort {
  try {
    return normalizeHomeConversationSort(
      localStorage.getItem(HOME_CONVERSATION_SORT_STORAGE_KEY),
    )
  } catch {
    return 'recentChat'
  }
}

export function writeHomeConversationSort(sort: HomeConversationSort): void {
  try {
    localStorage.setItem(HOME_CONVERSATION_SORT_STORAGE_KEY, sort)
  } catch {
    /* ignore */
  }
}

export function readHomeCharacterSort(): HomeCharacterSort {
  try {
    return normalizeHomeCharacterSort(
      localStorage.getItem(HOME_CHARACTER_SORT_STORAGE_KEY),
    )
  } catch {
    return 'recentChat'
  }
}

export function writeHomeCharacterSort(sort: HomeCharacterSort): void {
  try {
    localStorage.setItem(HOME_CHARACTER_SORT_STORAGE_KEY, sort)
  } catch {
    /* ignore */
  }
}

export function normalizeHomeSortOrder(raw: unknown): HomeSortOrder {
  return raw === 'asc' ? 'asc' : 'desc'
}

export function readHomeConversationSortOrder(): HomeSortOrder {
  try {
    return normalizeHomeSortOrder(
      localStorage.getItem(HOME_CONVERSATION_SORT_ORDER_STORAGE_KEY),
    )
  } catch {
    return 'desc'
  }
}

export function writeHomeConversationSortOrder(order: HomeSortOrder): void {
  try {
    localStorage.setItem(HOME_CONVERSATION_SORT_ORDER_STORAGE_KEY, order)
  } catch {
    /* ignore */
  }
}

export function readHomeCharacterSortOrder(): HomeSortOrder {
  try {
    return normalizeHomeSortOrder(
      localStorage.getItem(HOME_CHARACTER_SORT_ORDER_STORAGE_KEY),
    )
  } catch {
    return 'desc'
  }
}

export function writeHomeCharacterSortOrder(order: HomeSortOrder): void {
  try {
    localStorage.setItem(HOME_CHARACTER_SORT_ORDER_STORAGE_KEY, order)
  } catch {
    /* ignore */
  }
}
