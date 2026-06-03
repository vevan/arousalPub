/** 会话列表项是否引用某角色卡 id（含 user persona 与 legacy characterId） */
export function conversationUsesCharacter(
  entry: {
    userCharacterId?: string
    characterId?: string | null
    characterIds?: string[]
  },
  characterId: string,
): boolean {
  const cid = characterId.trim()
  if (!cid) return false
  if (entry.userCharacterId?.trim() === cid) return true
  if (entry.characterId?.trim() === cid) return true
  if (entry.characterIds?.some((id) => id.trim() === cid)) return true
  return false
}
