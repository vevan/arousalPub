import { readdir } from 'node:fs/promises'
import { isValidShortId } from './short-id.js'
import { isValidConversationId } from './conversation-id.js'
import { getChatsRoot } from './config.js'
import {
  readConversationIndex,
  updateConversationBackgroundImageFileId,
  updateConversationBgmFileId,
} from './chat-storage.js'
import {
  getImageFilesByCharacterIdMap,
  removeFileIdFromAllCharacterImageFiles,
  resolveCharacterNamesByIds,
} from './character-storage.js'
import { deleteFileLibraryEntry } from './file-library-storage.js'

export type FileLibraryReferenceKind =
  | 'character_image_file'
  | 'conversation_background'
  | 'conversation_bgm'

export interface FileLibraryReference {
  kind: FileLibraryReferenceKind
  characterId?: string
  characterName?: string
  conversationId?: string
  conversationTitle?: string
}

export class FileLibraryInUseError extends Error {
  readonly code = 'file_in_use' as const
  constructor(public readonly references: FileLibraryReference[]) {
    super('file_in_use')
    this.name = 'FileLibraryInUseError'
  }
}

function normalizeFileId(fileId: string): string | null {
  if (!isValidShortId(fileId)) return null
  return fileId.trim().toLowerCase()
}

async function listRootConversationIds(): Promise<string[]> {
  let entries
  try {
    entries = await readdir(getChatsRoot(), { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    if (!isValidConversationId(ent.name)) continue
    out.push(ent.name)
  }
  return out
}

export async function findFileLibraryReferences(
  fileId: string,
): Promise<FileLibraryReference[]> {
  const id = normalizeFileId(fileId)
  if (!id) return []

  const refs: FileLibraryReference[] = []

  const map = await getImageFilesByCharacterIdMap()
  const characterIds: string[] = []
  for (const [cid, list] of Object.entries(map)) {
    if (list.includes(id)) characterIds.push(cid)
  }
  const nameById = await resolveCharacterNamesByIds(characterIds)
  for (const cid of characterIds.sort()) {
    refs.push({
      kind: 'character_image_file',
      characterId: cid,
      characterName: nameById.get(cid) || cid,
    })
  }

  const convIds = await listRootConversationIds()
  for (const conversationId of convIds) {
    const idx = await readConversationIndex(conversationId)
    if (!idx) continue
    const title =
      typeof idx.title === 'string' && idx.title.trim()
        ? idx.title.trim()
        : conversationId
    if (idx.backgroundImageFileId === id) {
      refs.push({
        kind: 'conversation_background',
        conversationId,
        conversationTitle: title,
      })
    }
    if (idx.bgmFileId === id) {
      refs.push({
        kind: 'conversation_bgm',
        conversationId,
        conversationTitle: title,
      })
    }
  }

  refs.sort((a, b) => {
    const ka = `${a.kind}:${a.characterId ?? ''}:${a.conversationId ?? ''}`
    const kb = `${b.kind}:${b.characterId ?? ''}:${b.conversationId ?? ''}`
    return ka.localeCompare(kb, 'en')
  })
  return refs
}

/** 清除宿主字段中对该 fileId 的引用（不删文件本身） */
export async function clearFileLibraryReferences(fileId: string): Promise<{
  clearedCharacterBindings: number
  clearedConversationBackgrounds: number
  clearedConversationBgms: number
}> {
  const id = normalizeFileId(fileId)
  if (!id) {
    return {
      clearedCharacterBindings: 0,
      clearedConversationBackgrounds: 0,
      clearedConversationBgms: 0,
    }
  }

  const clearedCharacterBindings =
    await removeFileIdFromAllCharacterImageFiles(id)

  let clearedConversationBackgrounds = 0
  let clearedConversationBgms = 0
  const convIds = await listRootConversationIds()
  for (const conversationId of convIds) {
    const idx = await readConversationIndex(conversationId)
    if (!idx) continue
    if (idx.backgroundImageFileId === id) {
      await updateConversationBackgroundImageFileId(conversationId, null)
      clearedConversationBackgrounds += 1
    }
    if (idx.bgmFileId === id) {
      await updateConversationBgmFileId(conversationId, null)
      clearedConversationBgms += 1
    }
  }

  return {
    clearedCharacterBindings,
    clearedConversationBackgrounds,
    clearedConversationBgms,
  }
}

/**
 * 无 force 且有引用 → 抛 FileLibraryInUseError；
 * 否则先删文件，再清宿主引用（force 时即使初始扫描无引用也清一次，抗 TOCTOU）。
 * 返回 true：文件已删，或 force 下清掉了至少一处引用（含「文件已不在、仅清悬空引用」）。
 */
export async function deleteFileLibraryEntryWithReferenceCheck(
  fileId: string,
  opts: { force?: boolean },
): Promise<boolean> {
  const id = normalizeFileId(fileId)
  if (!id) return false

  const refs = await findFileLibraryReferences(id)
  if (refs.length > 0 && !opts.force) {
    throw new FileLibraryInUseError(refs)
  }

  // 先删文件再清引用：删失败时宿主绑定仍在；避免「引用已清、文件仍在」
  const deleted = await deleteFileLibraryEntry(id)

  if (!opts.force) {
    return deleted
  }

  const cleared = await clearFileLibraryReferences(id)
  const clearedAny =
    cleared.clearedCharacterBindings > 0 ||
    cleared.clearedConversationBackgrounds > 0 ||
    cleared.clearedConversationBgms > 0
  return deleted || clearedAny
}
