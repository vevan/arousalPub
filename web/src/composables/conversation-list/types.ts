export interface ChatListEntry {
  conversationId: string
  title: string
  updatedAt: string
  userName?: string
  userCharacterId?: string
  characterIds?: string[]
  characterNames?: string[]
  searchTags?: string[]
  activeTurnCount?: number
  /** active 路径末轮 createdAt */
  lastChatAt?: string
}

export interface CharacterPickerItem {
  id: string
  name: string
  summary: string
  isUser?: boolean
}

export interface LorebookPickerItem {
  id: string
  name: string
}

export interface CharacterStoredDocument {
  id: string
  card: Record<string, unknown>
}
