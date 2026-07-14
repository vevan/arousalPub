import { isValidShortId } from './short-id.js'
import { fileContentUrl } from './file-content-url.js'
import {
  getFileLibraryMeta,
  type FileLibraryMeta,
} from './file-library-storage.js'

export const CHARACTER_IMAGE_FILES_MAX = 30

export type CharacterImageFilesMap = Record<string, string[]>

export function normalizeFileNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** 去重、校验 short id；超长截断由调用方在校验阶段报错 */
export function normalizeImageFileIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim().toLowerCase()
    if (!isValidShortId(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function normalizeImageFilesByCharacterId(
  raw: unknown,
  validCharacterIds?: ReadonlySet<string>,
): CharacterImageFilesMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: CharacterImageFilesMap = {}
  for (const [cid, list] of Object.entries(raw as Record<string, unknown>)) {
    const id = cid.trim().toLowerCase()
    if (!isValidShortId(id)) continue
    if (validCharacterIds && !validCharacterIds.has(id)) continue
    const fileIds = normalizeImageFileIdList(list)
    if (fileIds.length === 0) continue
    out[id] = fileIds.slice(0, CHARACTER_IMAGE_FILES_MAX)
  }
  return out
}

export interface NameConflictInfo {
  nameKey: string
  fileIds: string[]
}

/** 绑定集内按当前 meta.name 检测重名（trim + 大小写不敏感） */
export function findDuplicateNamesInMetas(
  metas: readonly FileLibraryMeta[],
): NameConflictInfo[] {
  const byKey = new Map<string, string[]>()
  for (const m of metas) {
    const key = normalizeFileNameKey(m.name)
    if (!key) continue
    const list = byKey.get(key) ?? []
    list.push(m.fileId)
    byKey.set(key, list)
  }
  const conflicts: NameConflictInfo[] = []
  for (const [nameKey, fileIds] of byKey) {
    if (fileIds.length > 1) {
      conflicts.push({ nameKey, fileIds: [...fileIds].sort() })
    }
  }
  conflicts.sort((a, b) => a.nameKey.localeCompare(b.nameKey, 'en'))
  return conflicts
}

/** 同名多条时取 createdAt 最早，并列 fileId 字典序 */
export function pickEarliestMeta(
  metas: readonly FileLibraryMeta[],
): FileLibraryMeta | null {
  if (metas.length === 0) return null
  const sorted = [...metas].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt, 'en')
    if (byTime !== 0) return byTime
    return a.fileId.localeCompare(b.fileId, 'en')
  })
  return sorted[0] ?? null
}

export interface BoundFileLookup {
  fileIds: string[]
  /** fileId → 相对 /api/m/… */
  urlById: Map<string, string>
  /** normalized name → url（已按最早策略消歧） */
  urlByName: Map<string, string>
  nameConflict: boolean
}

export function buildBoundFileLookup(
  fileIds: string[],
  metas: readonly FileLibraryMeta[],
  userId?: string,
): BoundFileLookup {
  const metaById = new Map(metas.map((m) => [m.fileId, m]))
  const urlById = new Map<string, string>()
  const byName = new Map<string, FileLibraryMeta[]>()

  for (const id of fileIds) {
    const meta = metaById.get(id)
    if (!meta) continue
    urlById.set(id, fileContentUrl(meta.fileId, userId))
    const key = normalizeFileNameKey(meta.name)
    if (!key) continue
    const list = byName.get(key) ?? []
    list.push(meta)
    byName.set(key, list)
  }

  const urlByName = new Map<string, string>()
  let nameConflict = false
  for (const [key, list] of byName) {
    if (list.length > 1) nameConflict = true
    const pick = pickEarliestMeta(list)
    if (pick) urlByName.set(key, fileContentUrl(pick.fileId, userId))
  }

  return {
    fileIds: [...fileIds],
    urlById,
    urlByName,
    nameConflict,
  }
}

export function resolveBoundFileById(
  lookup: BoundFileLookup | undefined,
  fileIdRaw: string,
): string {
  if (!lookup) return ''
  const id = fileIdRaw.trim().toLowerCase()
  if (!isValidShortId(id)) return ''
  if (!lookup.fileIds.includes(id)) return ''
  return lookup.urlById.get(id) ?? ''
}

export function resolveBoundFileByName(
  lookup: BoundFileLookup | undefined,
  nameRaw: string,
): string {
  if (!lookup) return ''
  const key = normalizeFileNameKey(nameRaw)
  if (!key) return ''
  return lookup.urlByName.get(key) ?? ''
}

export async function loadMetasForFileIds(
  fileIds: string[],
): Promise<FileLibraryMeta[]> {
  const out: FileLibraryMeta[] = []
  for (const id of fileIds) {
    const meta = await getFileLibraryMeta(id)
    if (meta) out.push(meta)
  }
  return out
}
