export interface CharacterListItem {
  id: string
  name: string
  summary: string
  systemPromptPreview: string
  tags: string[]
  updatedAt: string
  usedInConversationCount: number
  isUser: boolean
}

export interface CharacterDoc {
  schemaVersion: 1
  id: string
  importedAt: string
  updatedAt: string
  card: Record<string, unknown>
  isUser?: boolean
}

export interface ListResponse {
  items: CharacterListItem[]
  total: number
  filterCounts: {
    all: number
    used: number
    unused: number
    kindAll: number
    kindUser: number
    kindNotUser: number
  }
  offset: number
  limit: number
  hasMore: boolean
}

export type CharacterKind = 'all' | 'user' | 'notUser'
export type CharacterUsageFilter = 'all' | 'used' | 'unused'
export type CharacterSort =
  | 'recentChat'
  | 'recentUpdate'
  | 'name'
  | 'usageCount'
export type CharacterSortOrder = 'asc' | 'desc'
export type CharFormMode = 'create' | 'edit'

export type AltGreetRow = { id: string; text: string }

export const CHARACTER_SORT_OPTIONS = [
  'recentChat',
  'recentUpdate',
  'name',
  'usageCount',
] as const satisfies readonly CharacterSort[]

export const CHARACTER_LIST_PAGE = 24
