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
  return boundCharacterIds(entry).includes(cid)
}

/** 会话绑定的角色卡 id（去重、保序；legacy characterId 作兜底） */
export function boundCharacterIds(entry: {
  characterId?: string | null
  characterIds?: string[]
}): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  if (Array.isArray(entry.characterIds)) {
    for (const raw of entry.characterIds) {
      if (typeof raw !== 'string') continue
      const id = raw.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  if (ids.length === 0) {
    const legacy =
      typeof entry.characterId === 'string' ? entry.characterId.trim() : ''
    if (legacy) ids.push(legacy)
  }
  return ids
}
