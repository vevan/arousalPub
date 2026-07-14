import {
  buildBoundFileLookup,
  loadMetasForFileIds,
  type BoundFileLookup,
} from './character-image-files.js'
import { getImageFilesByCharacterIdMap } from './character-storage.js'
import { getCurrentUserId } from './user-context.js'

/** 按会话绑定角色顺序预加载宏用 lookup（同步展宏前调用） */
export async function loadCharFileLookupsForIds(
  characterIds: string[],
  userCharacterId?: string | null,
): Promise<{
  charFileLookups: BoundFileLookup[]
  userFileLookup?: BoundFileLookup
}> {
  const userId = getCurrentUserId()
  const map = await getImageFilesByCharacterIdMap()

  const charFileLookups: BoundFileLookup[] = []
  for (const raw of characterIds) {
    const cid = raw.trim().toLowerCase()
    if (!cid) {
      charFileLookups.push(buildBoundFileLookup([], [], userId))
      continue
    }
    const fileIds = map[cid] ?? []
    const metas = await loadMetasForFileIds(fileIds)
    charFileLookups.push(buildBoundFileLookup(fileIds, metas, userId))
  }

  let userFileLookup: BoundFileLookup | undefined
  const uid = userCharacterId?.trim().toLowerCase()
  if (uid) {
    const fileIds = map[uid] ?? []
    const metas = await loadMetasForFileIds(fileIds)
    userFileLookup = buildBoundFileLookup(fileIds, metas, userId)
  }
  return { charFileLookups, userFileLookup }
}
