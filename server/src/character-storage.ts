import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCharactersDir } from './config.js'
import type { ChatListEntry, ConversationIndex } from './chat-storage.js'
import { readChatList, resolvedCharacterIds } from './chat-storage.js'
import { resolveActivePathConversationStats } from './chunk-chain.js'
import {
  embedCharaInPng,
  extractCardFromPng,
  isPngBuffer,
  normalizeTavernCardV2Data,
} from './character-png.js'
import { compareCharacterNamesAsc } from './character-name-sort.js'
import { generateShortId, isValidShortId } from './short-id.js'
import {
  CHARACTER_IMAGE_FILES_MAX,
  findDuplicateNamesInMetas,
  loadMetasForFileIds,
  normalizeImageFileIdList,
  normalizeImageFilesByCharacterId,
  type CharacterImageFilesMap,
} from './character-image-files.js'
import { fileContentUrl } from './file-content-url.js'

const SHORT_PNG = /^([0-9a-f]{8})\.png$/i

function characterIndexFile(): string {
  return path.join(getCharactersDir(), 'index.json')
}

/** 打包在 server 内的默认立绘（非用户数据） */
export function resolveDefaultAvatarPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../assets/characters/default-avatar.png',
  )
}

interface CharacterIndexEntry {
  id: string
  importedAt: string
  updatedAt: string
  name: string
  summary: string
  descriptionPreview?: string
  personalityPreview?: string
  systemPromptPreview: string
  tags: string[]
}

interface CharacterIndexFile {
  schemaVersion: 1
  generatedAt: string
  entries: CharacterIndexEntry[]
  /** 本库中标记为用户身份卡的角色 id（不写入 PNG） */
  userCardList?: string[]
  /** 角色绑定的文件库 fileId 列表（不写入 PNG；每角色 ≤30） */
  imageFilesByCharacterId?: CharacterImageFilesMap
}

export type CharacterListKind = 'all' | 'user' | 'notUser'

export interface CharacterListFilterCounts {
  all: number
  used: number
  unused: number
  kindAll: number
  kindUser: number
  kindNotUser: number
}

export interface CharacterListItem {
  id: string
  name: string
  summary: string
  descriptionPreview: string
  personalityPreview: string
  systemPromptPreview: string
  tags: string[]
  updatedAt: string
  usedInConversationCount: number
  /** 绑定该卡的会话中，最近一次 `updatedAt`（无绑定则为 null） */
  lastConversationAt: string | null
  isUser: boolean
}

export type CharacterListSort =
  | 'recentChat'
  | 'recentUpdate'
  | 'name'
  | 'usageCount'

export type CharacterListSortOrder = 'asc' | 'desc'

export interface CharacterStoredDocument {
  schemaVersion: 1
  id: string
  importedAt: string
  updatedAt: string
  card: Record<string, unknown>
}

export interface CharacterDocumentForApi extends CharacterStoredDocument {
  isUser: boolean
}

function normalizeUserCardList(
  raw: unknown,
  validIds?: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!isValidShortId(id) || seen.has(id)) continue
    if (validIds && !validIds.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  out.sort((a, b) => a.localeCompare(b, 'en'))
  return out
}

function finalizeIndexFile(data: CharacterIndexFile): CharacterIndexFile {
  const validIds = new Set(data.entries.map((e) => e.id))
  data.userCardList = normalizeUserCardList(data.userCardList, validIds)
  data.imageFilesByCharacterId = normalizeImageFilesByCharacterId(
    data.imageFilesByCharacterId,
    validIds,
  )
  return data
}

function userCardSetFromIndex(idx: CharacterIndexFile): Set<string> {
  return new Set(normalizeUserCardList(idx.userCardList))
}

export function parseCharacterListKind(raw: unknown): CharacterListKind {
  if (raw === 'all' || raw === 'user' || raw === 'notUser') return raw
  return 'notUser'
}

export function parseIsUserFromBody(body: unknown): boolean | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const v = (body as Record<string, unknown>).isUser
  return typeof v === 'boolean' ? v : undefined
}

function nowIso(): string {
  return new Date().toISOString()
}

async function refStats(): Promise<
  Map<string, { count: number; lastConversationAt: string | null }>
> {
  const list = await readChatList()
  const stats = new Map<
    string,
    { count: number; lastConversationAt: string | null }
  >()
  for (const entry of list.conversations) {
    const ids = resolvedCharacterIds(entry)
    const convRecent =
      (typeof entry.lastChatAt === 'string' && entry.lastChatAt.trim()) ||
      (typeof entry.updatedAt === 'string' ? entry.updatedAt : null)
    for (const cid of ids) {
      const prev = stats.get(cid)
      if (!prev) {
        stats.set(cid, { count: 1, lastConversationAt: convRecent })
        continue
      }
      prev.count++
      if (
        convRecent &&
        (!prev.lastConversationAt ||
          convRecent.localeCompare(prev.lastConversationAt, 'en') > 0)
      ) {
        prev.lastConversationAt = convRecent
      }
    }
  }
  return stats
}

function compareCharacterRowsAsc(
  a: CharacterListItem,
  b: CharacterListItem,
  sort: CharacterListSort,
): number {
  switch (sort) {
    case 'recentChat': {
      const ta = a.lastConversationAt ?? ''
      const tb = b.lastConversationAt ?? ''
      if (ta !== tb) return ta.localeCompare(tb, 'en')
      return a.updatedAt.localeCompare(b.updatedAt, 'en')
    }
    case 'name': {
      const byName = compareCharacterNamesAsc(a.name, b.name)
      if (byName !== 0) return byName
      return a.updatedAt.localeCompare(b.updatedAt, 'en')
    }
    case 'usageCount': {
      const d = a.usedInConversationCount - b.usedInConversationCount
      if (d !== 0) return d
      return a.updatedAt.localeCompare(b.updatedAt, 'en')
    }
    case 'recentUpdate':
    default:
      return a.updatedAt.localeCompare(b.updatedAt, 'en')
  }
}

function sortCharacterRows(
  rows: CharacterListItem[],
  sort: CharacterListSort,
  order: CharacterListSortOrder = 'asc',
): void {
  const sign = order === 'asc' ? 1 : -1
  rows.sort((a, b) => sign * compareCharacterRowsAsc(a, b, sort))
}

export function parseCharacterListSort(raw: unknown): CharacterListSort {
  if (
    raw === 'recentChat' ||
    raw === 'recentUpdate' ||
    raw === 'name' ||
    raw === 'usageCount'
  ) {
    return raw
  }
  return 'name'
}

export function parseCharacterListSortOrder(
  raw: unknown,
): CharacterListSortOrder {
  return raw === 'desc' ? 'desc' : 'asc'
}

function pickName(card: Record<string, unknown>): string {
  const n = card.name
  if (typeof n === 'string' && n.trim()) return n.trim()
  return '未命名'
}

function pickSummary(card: Record<string, unknown>, max = 180): string {
  for (const k of ['description', 'creator_notes', 'personality'] as const) {
    const v = card[k]
    if (typeof v === 'string' && v.trim()) {
      const t = v.trim().replace(/\s+/g, ' ')
      return t.length > max ? `${t.slice(0, max)}…` : t
    }
  }
  return ''
}

function pickCardTextPreview(
  card: Record<string, unknown>,
  field: 'description' | 'personality',
  max = 140,
): string {
  const v = card[field]
  if (typeof v !== 'string' || !v.trim()) return ''
  const t = v.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function pickSystemPreview(card: Record<string, unknown>, max = 240): string {
  const v = card.system_prompt
  if (typeof v === 'string' && v.trim()) {
    const t = v.trim().replace(/\s+/g, ' ')
    return t.length > max ? `${t.slice(0, max)}…` : t
  }
  return ''
}

function pickTags(card: Record<string, unknown>): string[] {
  const t = card.tags
  if (Array.isArray(t)) {
    return t
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, 8)
  }
  if (typeof t === 'string' && t.trim()) {
    return t
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8)
  }
  return []
}


function entryFromDoc(doc: CharacterStoredDocument): CharacterIndexEntry {
  return {
    id: doc.id,
    importedAt: doc.importedAt,
    updatedAt: doc.updatedAt,
    name: pickName(doc.card),
    summary: pickSummary(doc.card),
    descriptionPreview: pickCardTextPreview(doc.card, 'description'),
    personalityPreview: pickCardTextPreview(doc.card, 'personality'),
    systemPromptPreview: pickSystemPreview(doc.card),
    tags: pickTags(doc.card),
  }
}

async function listCharacterIdsOnDisk(): Promise<Set<string>> {
  const names = await readdir(getCharactersDir()).catch(() => [] as string[])
  const ids = new Set<string>()
  for (const n of names) {
    const mp = SHORT_PNG.exec(n)
    if (mp) ids.add(mp[1])
  }
  return ids
}

async function countCharacterDataIds(): Promise<number> {
  return (await listCharacterIdsOnDisk()).size
}

async function readIndexFile(): Promise<CharacterIndexFile | null> {
  try {
    const raw = JSON.parse(
      await readFile(characterIndexFile(), 'utf8'),
    ) as unknown
    if (
      !raw ||
      typeof raw !== 'object' ||
      (raw as CharacterIndexFile).schemaVersion !== 1 ||
      !Array.isArray((raw as CharacterIndexFile).entries)
    ) {
      return null
    }
    return finalizeIndexFile(raw as CharacterIndexFile)
  } catch {
    return null
  }
}

async function writeIndexFile(data: CharacterIndexFile): Promise<void> {
  finalizeIndexFile(data)
  data.generatedAt = nowIso()
  await writeFile(
    characterIndexFile(),
    `${JSON.stringify(data, null, 2)}\n`,
    'utf8',
  )
}

/** 重建索引：扫描 `{id}.png` */
async function readDocFromDiskForRebuild(
  id: string,
): Promise<CharacterStoredDocument | null> {
  const pngPath = path.join(getCharactersDir(), `${id}.png`)
  try {
    const buf = await readFile(pngPath)
    const card = extractCardFromPng(buf)
    const st = await stat(pngPath)
    const updatedAt = new Date(st.mtimeMs).toISOString()
    const importedAt = new Date(
      st.birthtimeMs || st.ctimeMs || st.mtimeMs,
    ).toISOString()
    return {
      schemaVersion: 1,
      id,
      importedAt,
      updatedAt,
      card,
    }
  } catch {
    return null
  }
}

export async function rebuildCharacterIndexFromDisk(): Promise<CharacterIndexFile> {
  await mkdir(getCharactersDir(), { recursive: true })
  const old = await readIndexFile()
  const ids = await listCharacterIdsOnDisk()
  const entries: CharacterIndexEntry[] = []
  for (const id of ids) {
    const doc = await readDocFromDiskForRebuild(id)
    if (!doc || doc.id !== id) continue
    entries.push(entryFromDoc(doc))
  }
  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt, 'en'))
  const validIds = new Set(entries.map((e) => e.id))
  const file: CharacterIndexFile = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    entries,
    userCardList: normalizeUserCardList(old?.userCardList, validIds),
    imageFilesByCharacterId: normalizeImageFilesByCharacterId(
      old?.imageFilesByCharacterId,
      validIds,
    ),
  }
  await writeIndexFile(file)
  return file
}

async function loadOrRebuildIndex(): Promise<CharacterIndexFile> {
  const fromDisk = await readIndexFile()
  if (!fromDisk) {
    return rebuildCharacterIndexFromDisk()
  }
  const diskCount = await countCharacterDataIds()
  if (fromDisk.entries.length !== diskCount) {
    return rebuildCharacterIndexFromDisk()
  }
  if (
    fromDisk.entries.some(
      (e) =>
        typeof e.descriptionPreview !== 'string' ||
        typeof e.personalityPreview !== 'string',
    )
  ) {
    return rebuildCharacterIndexFromDisk()
  }
  for (const e of fromDisk.entries) {
    const png = path.join(getCharactersDir(), `${e.id}.png`)
    try {
      await stat(png)
    } catch {
      return rebuildCharacterIndexFromDisk()
    }
  }
  return fromDisk
}

async function upsertIndexEntry(doc: CharacterStoredDocument): Promise<void> {
  const idx = await loadOrRebuildIndex()
  const ent = entryFromDoc(doc)
  const i = idx.entries.findIndex((x) => x.id === doc.id)
  if (i >= 0) idx.entries[i] = ent
  else idx.entries.unshift(ent)
  idx.entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt, 'en'))
  await writeIndexFile(idx)
}

async function removeIndexEntry(id: string): Promise<void> {
  const idx = await readIndexFile()
  if (!idx) return
  idx.entries = idx.entries.filter((e) => e.id !== id)
  if (idx.userCardList?.length) {
    idx.userCardList = idx.userCardList.filter((x) => x !== id)
  }
  if (idx.imageFilesByCharacterId?.[id]) {
    const next = { ...idx.imageFilesByCharacterId }
    delete next[id]
    idx.imageFilesByCharacterId = next
  }
  await writeIndexFile(idx)
}

export async function updateCharacterUserMark(
  id: string,
  isUser: boolean,
): Promise<boolean> {
  if (!isValidShortId(id)) return false
  const idx = await loadOrRebuildIndex()
  if (!idx.entries.some((e) => e.id === id)) return false
  const set = userCardSetFromIndex(idx)
  if (isUser) set.add(id)
  else set.delete(id)
  idx.userCardList = [...set].sort((a, b) => a.localeCompare(b, 'en'))
  await writeIndexFile(idx)
  return true
}

export async function readCharacterDocumentForApi(
  id: string,
): Promise<CharacterDocumentForApi | null> {
  const doc = await readCharacterDocument(id)
  if (!doc) return null
  const idx = await loadOrRebuildIndex()
  const isUser = userCardSetFromIndex(idx).has(id)
  return { ...doc, isUser }
}

export async function patchCharacterDocument(
  id: string,
  patch: { card?: Record<string, unknown>; isUser?: boolean },
): Promise<CharacterDocumentForApi | null> {
  if (!isValidShortId(id)) return null
  if (!patch.card && typeof patch.isUser !== 'boolean') return null
  if (patch.card) {
    const doc = await updateCharacterDocument(id, patch.card)
    if (!doc) return null
  } else {
    const doc = await readCharacterDocument(id)
    if (!doc) return null
  }
  if (typeof patch.isUser === 'boolean') {
    const ok = await updateCharacterUserMark(id, patch.isUser)
    if (!ok) return null
  }
  return readCharacterDocumentForApi(id)
}

export function normalizeImportCard(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体须为 JSON 对象')
  }
  const o = body as Record<string, unknown>
  if (o.card && typeof o.card === 'object' && !Array.isArray(o.card)) {
    return o.card as Record<string, unknown>
  }
  if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) {
    return { ...(o.data as Record<string, unknown>) }
  }
  return o
}

/** 从表单字段生成最小 Character Card V2 兼容对象（新建角色） */
export function cardFromNewCharacterForm(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体须为 JSON 对象')
  }
  const o = body as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!name) {
    throw new Error('角色名称不能为空')
  }
  const str = (k: string) =>
    typeof o[k] === 'string' ? (o[k] as string) : ''

  let tags: string[] = []
  const rawTags = o.tags
  if (Array.isArray(rawTags)) {
    tags = rawTags
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, 16)
  } else if (typeof rawTags === 'string' && rawTags.trim()) {
    tags = rawTags
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 16)
  }

  let alternateGreetings: string[] = []
  const rawAg = o.alternate_greetings
  if (Array.isArray(rawAg)) {
    alternateGreetings = rawAg
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, 256)
  } else if (typeof rawAg === 'string' && rawAg.trim()) {
    alternateGreetings = rawAg
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 256)
  }

  let extensions: Record<string, unknown> = {}
  if (
    o.extensions &&
    typeof o.extensions === 'object' &&
    !Array.isArray(o.extensions)
  ) {
    extensions = { ...(o.extensions as Record<string, unknown>) }
  }

  return {
    name,
    description: str('description').trim(),
    personality: str('personality').trim(),
    scenario: str('scenario').trim(),
    first_mes: str('first_mes').trim(),
    mes_example: str('mes_example').trim(),
    creator_notes: str('creator_notes').trim(),
    system_prompt: str('system_prompt').trim(),
    post_history_instructions: str('post_history_instructions').trim(),
    character_version: str('character_version').trim() || '2.0',
    tags,
    creator: str('creator').trim(),
    alternate_greetings: alternateGreetings,
    extensions,
  }
}

async function readOneFile(id: string): Promise<CharacterStoredDocument | null> {
  if (!isValidShortId(id)) return null
  const pngPath = path.join(getCharactersDir(), `${id}.png`)
  try {
    const buf = await readFile(pngPath)
    const card = extractCardFromPng(buf)
    const st = await stat(pngPath)
    const updatedAt = new Date(st.mtimeMs).toISOString()
    const idx = await readIndexFile()
    const ent = idx?.entries.find((x) => x.id === id)
    const importedAt =
      ent?.importedAt ??
      new Date(st.birthtimeMs || st.ctimeMs || st.mtimeMs).toISOString()
    return {
      schemaVersion: 1,
      id,
      importedAt,
      updatedAt,
      card,
    }
  } catch {
    return null
  }
}

/**
 * 新建角色：写入 `data/characters/{id}.png`（8 位 hex id，内嵌 chara）。
 * `portraitPng` 为可选用户 PNG；缺省则用内置默认立绘。
 */
export async function importCharacterCardWithPortrait(
  card: Record<string, unknown>,
  portraitPng?: Buffer | null,
  options?: { isUser?: boolean },
): Promise<CharacterStoredDocument> {
  await mkdir(getCharactersDir(), { recursive: true })
  let base: Buffer
  if (portraitPng && isPngBuffer(portraitPng)) {
    base = portraitPng
  } else {
    base = await readFile(resolveDefaultAvatarPath())
  }
  const normalCard = normalizeTavernCardV2Data(card)
  const pngOut = embedCharaInPng(base, normalCard)
  const t = nowIso()
  const id = generateShortId()
  const doc: CharacterStoredDocument = {
    schemaVersion: 1,
    id,
    importedAt: t,
    updatedAt: t,
    card: normalCard,
  }
  await writeFile(path.join(getCharactersDir(), `${id}.png`), pngOut)
  await upsertIndexEntry(doc)
  if (options?.isUser) {
    await updateCharacterUserMark(id, true)
  }
  return doc
}

export async function importCharacterCard(
  card: Record<string, unknown>,
): Promise<CharacterStoredDocument> {
  return importCharacterCardWithPortrait(card, null)
}

/** 导入完整 ST 角色卡 PNG（字节落盘，分配新 8 位 id 文件名） */
export async function importCharacterCardPng(
  pngBuffer: Buffer,
): Promise<CharacterStoredDocument> {
  if (!isPngBuffer(pngBuffer)) {
    throw new Error('须为 PNG 文件')
  }
  const card = extractCardFromPng(pngBuffer)
  await mkdir(getCharactersDir(), { recursive: true })
  const t = nowIso()
  const id = generateShortId()
  const doc: CharacterStoredDocument = {
    schemaVersion: 1,
    id,
    importedAt: t,
    updatedAt: t,
    card,
  }
  await writeFile(path.join(getCharactersDir(), `${id}.png`), pngBuffer)
  await upsertIndexEntry(doc)
  return doc
}

export async function deleteCharacterFile(id: string): Promise<boolean> {
  if (!isValidShortId(id)) return false
  let removed = false
  try {
    await unlink(path.join(getCharactersDir(), `${id}.png`))
    removed = true
  } catch {
    /* */
  }
  if (!removed) return false
  await removeIndexEntry(id)
  const { refreshChatListEntriesForCharacter } = await import(
    './chat-storage.js'
  )
  await refreshChatListEntriesForCharacter(id)
  return true
}

const DELETED_CHARACTER_LABEL = '已删除'

export interface CharacterIndexMeta {
  name: string
  tags: string[]
}

export async function getCharacterIndexMetaMap(): Promise<
  Map<string, CharacterIndexMeta>
> {
  const idx = await loadOrRebuildIndex()
  const m = new Map<string, CharacterIndexMeta>()
  for (const e of idx.entries) {
    m.set(e.id, { name: e.name, tags: e.tags })
  }
  return m
}

/** GET 会话详情：按 characterIds 填充 characterNames（不落盘 index.json） */
export async function enrichConversationIndexForClient(
  idx: ConversationIndex,
): Promise<ConversationIndex & { characterNames?: string[] }> {
  const ids = resolvedCharacterIds(idx)
  if (ids.length === 0) return idx
  const characterNames = await loadCharacterDisplayNamesForIds(ids)
  return { ...idx, characterNames }
}

/** 与 characterIds 同序的 displayName（卡已删时为「已删除」） */
export async function loadCharacterDisplayNamesForIds(
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return []
  const map = await getCharacterIndexMetaMap()
  return ids.map((id) => map.get(id.trim())?.name ?? DELETED_CHARACTER_LABEL)
}

function bindingIdsForEnrich(
  entry: ChatListEntry,
  source?: Pick<
    ConversationIndex,
    'userName' | 'userCharacterId' | 'characterIds'
  >,
): string[] {
  if (source) return resolvedCharacterIds(source)
  return resolvedCharacterIds({ characterIds: entry.characterIds })
}

export function listLastChatAtFromStats(
  stats: { turnCount: number; lastChatAt: string | null },
  updatedAt: string | undefined,
): string | undefined {
  const fromTurn = stats.lastChatAt?.trim()
  if (fromTurn) return fromTurn
  if (stats.turnCount > 0) {
    const fallback = typeof updatedAt === 'string' ? updatedAt.trim() : ''
    if (fallback) return fallback
  }
  return undefined
}

/** 列表项是否缺少快查冗余（用于 readChatList 迁移） */
export function chatListEntryNeedsEnrich(entry: ChatListEntry): boolean {
  const ids = bindingIdsForEnrich(entry)
  const userCid =
    typeof entry.userCharacterId === 'string' && entry.userCharacterId.trim()
      ? entry.userCharacterId.trim()
      : null
  if (ids.length === 0 && !userCid) return false
  if (ids.length > 0) {
    const names = entry.characterNames
    if (!Array.isArray(names) || names.length !== ids.length) return true
  }
  const hasTagSources = ids.length > 0 || !!userCid
  if (hasTagSources && !Array.isArray(entry.searchTags)) return true
  if (typeof entry.activeTurnCount !== 'number') return true
  if (entry.activeTurnCount > 0) {
    const last = entry.lastChatAt
    if (typeof last !== 'string' || !last.trim()) return true
  }
  return false
}

/**
 * 用 characters/index.json 填充列表快查字段（名、合并 tags）。
 * `source` 为会话根 index 时可带上最新 userName。
 */
export async function enrichChatListEntry(
  entry: ChatListEntry,
  source?: Pick<
    ConversationIndex,
    'userName' | 'userCharacterId' | 'characterIds'
  >,
): Promise<ChatListEntry> {
  const map = await getCharacterIndexMetaMap()
  const ids = bindingIdsForEnrich(entry, source)
  const userCid =
    (typeof source?.userCharacterId === 'string' &&
      source.userCharacterId.trim()) ||
    (typeof entry.userCharacterId === 'string' && entry.userCharacterId.trim()
      ? entry.userCharacterId.trim()
      : '')
  const userNameRaw =
    (typeof source?.userName === 'string' && source.userName.trim()) ||
    (typeof entry.userName === 'string' && entry.userName.trim()
      ? entry.userName.trim()
      : '')
  const characterNames =
    ids.length > 0
      ? ids.map((id) => map.get(id)?.name ?? DELETED_CHARACTER_LABEL)
      : undefined
  const tagSet = new Set<string>()
  for (const id of ids) {
    const tags = map.get(id)?.tags
    if (!tags) continue
    for (const t of tags) {
      const s = typeof t === 'string' ? t.trim() : ''
      if (s) tagSet.add(s)
    }
  }
  if (userCid) {
    const tags = map.get(userCid)?.tags
    if (tags) {
      for (const t of tags) {
        const s = typeof t === 'string' ? t.trim() : ''
        if (s) tagSet.add(s)
      }
    }
  }
  const searchTags = tagSet.size > 0 ? [...tagSet] : undefined
  let activeTurnCount = entry.activeTurnCount
  let lastChatAt =
    typeof entry.lastChatAt === 'string' && entry.lastChatAt.trim()
      ? entry.lastChatAt.trim()
      : undefined
  const needsCount = typeof activeTurnCount !== 'number'
  const needsLast =
    (needsCount ? true : (activeTurnCount ?? 0) > 0) &&
    !(typeof lastChatAt === 'string' && lastChatAt.trim())
  if (needsCount || needsLast) {
    try {
      const stats = await resolveActivePathConversationStats(
        entry.conversationId,
      )
      if (needsCount) activeTurnCount = stats.turnCount
      if (needsLast) {
        lastChatAt = listLastChatAtFromStats(stats, entry.updatedAt)
      }
    } catch {
      if (needsCount) activeTurnCount = 0
    }
  }
  const enriched: ChatListEntry = {
    ...entry,
    ...(userNameRaw ? { userName: userNameRaw } : {}),
    ...(characterNames?.length ? { characterNames } : {}),
    ...(searchTags ? { searchTags } : {}),
    activeTurnCount: activeTurnCount ?? 0,
  }
  if (lastChatAt) enriched.lastChatAt = lastChatAt
  else delete enriched.lastChatAt
  return enriched
}

/**
 * 合并更新角色卡 `card` 字段（浅合并 patch 顶层键），更新 `updatedAt` 与索引。
 */
export async function updateCharacterDocument(
  id: string,
  cardPatch: Record<string, unknown>,
): Promise<CharacterStoredDocument | null> {
  if (!isValidShortId(id)) return null
  const doc = await readOneFile(id)
  if (!doc) return null
  const merged: Record<string, unknown> = { ...doc.card }
  for (const [k, v] of Object.entries(cardPatch)) {
    merged[k] = v
  }
  const normalCard = normalizeTavernCardV2Data(merged)
  const pngPath = path.join(getCharactersDir(), `${id}.png`)
  const buf = await readFile(pngPath)
  const out = embedCharaInPng(buf, normalCard)
  await writeFile(pngPath, out)
  const next: CharacterStoredDocument = {
    ...doc,
    card: normalCard,
    updatedAt: nowIso(),
  }
  await upsertIndexEntry(next)
  const { refreshChatListEntriesForCharacter } = await import(
    './chat-storage.js'
  )
  await refreshChatListEntriesForCharacter(id)
  return next
}

/** 用新 PNG 图像替换立绘，保留当前 card 元数据 */
export async function updateCharacterPortrait(
  id: string,
  portraitPng: Buffer,
): Promise<CharacterStoredDocument | null> {
  if (!isValidShortId(id) || !isPngBuffer(portraitPng)) return null
  const doc = await readCharacterDocument(id)
  if (!doc) return null
  const normalCard = normalizeTavernCardV2Data(
    doc.card as Record<string, unknown>,
  )
  const out = embedCharaInPng(portraitPng, normalCard)
  const pngPath = path.join(getCharactersDir(), `${id}.png`)
  await writeFile(pngPath, out)
  const next: CharacterStoredDocument = {
    ...doc,
    updatedAt: nowIso(),
  }
  await upsertIndexEntry(next)
  return next
}

export async function listCharacterSummaries(params: {
  offset: number
  limit: number
  search?: string
  filter?: 'all' | 'used' | 'unused'
  kind?: CharacterListKind
  sort?: CharacterListSort
  order?: CharacterListSortOrder
}): Promise<{
  items: CharacterListItem[]
  total: number
  filterCounts: CharacterListFilterCounts
}> {
  await mkdir(getCharactersDir(), { recursive: true })
  const stats = await refStats()
  const idx = await loadOrRebuildIndex()
  const userSet = userCardSetFromIndex(idx)
  const rows: CharacterListItem[] = []

  for (const e of idx.entries) {
    const id = e.id
    let updatedAt = e.updatedAt
    const pngPath = path.join(getCharactersDir(), `${id}.png`)
    try {
      const st = await stat(pngPath)
      updatedAt = new Date(st.mtimeMs).toISOString()
    } catch {
      /* keep index */
    }
    const ref = stats.get(id)
    const usedN = ref?.count ?? 0
    rows.push({
      id,
      name: e.name,
      summary: e.summary,
      descriptionPreview: e.descriptionPreview ?? e.summary,
      personalityPreview: e.personalityPreview ?? '',
      systemPromptPreview: e.systemPromptPreview,
      tags: e.tags,
      updatedAt,
      usedInConversationCount: usedN,
      lastConversationAt: ref?.lastConversationAt ?? null,
      isUser: userSet.has(id),
    })
  }

  const q = (params.search ?? '').trim().toLowerCase()
  const filter = params.filter ?? 'all'
  const kind = params.kind ?? 'notUser'
  let searchFiltered = rows
  if (q) {
    searchFiltered = searchFiltered.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q) ||
        r.descriptionPreview.toLowerCase().includes(q) ||
        r.personalityPreview.toLowerCase().includes(q) ||
        r.systemPromptPreview.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }

  const filterCounts: CharacterListFilterCounts = {
    all: searchFiltered.length,
    used: searchFiltered.filter((r) => r.usedInConversationCount > 0).length,
    unused: searchFiltered.filter((r) => r.usedInConversationCount === 0)
      .length,
    kindAll: searchFiltered.length,
    kindUser: searchFiltered.filter((r) => r.isUser).length,
    kindNotUser: searchFiltered.filter((r) => !r.isUser).length,
  }

  let kindFiltered = searchFiltered
  if (kind === 'user') {
    kindFiltered = kindFiltered.filter((r) => r.isUser)
  } else if (kind === 'notUser') {
    kindFiltered = kindFiltered.filter((r) => !r.isUser)
  }

  let filtered = kindFiltered
  if (filter === 'used') {
    filtered = filtered.filter((r) => r.usedInConversationCount > 0)
  } else if (filter === 'unused') {
    filtered = filtered.filter((r) => r.usedInConversationCount === 0)
  }

  sortCharacterRows(
    filtered,
    params.sort ?? 'name',
    params.order ?? 'asc',
  )

  const total = filtered.length
  const offset = Math.max(0, Math.floor(params.offset) || 0)
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit) || 24))
  const items = filtered.slice(offset, offset + limit)
  return { items, total, filterCounts }
}

export async function readCharacterDocument(
  id: string,
): Promise<CharacterStoredDocument | null> {
  if (!isValidShortId(id)) return null
  return readOneFile(id)
}

/** 导出文件名基底（去 Windows 非法字符；空则回退 id） */
export function buildCharacterExportBasename(
  card: Record<string, unknown>,
  id: string,
): string {
  const raw = pickName(card).trim()
  let base = raw
    .replace(/[\x00-\x1f\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!base) base = id
  if (base.length > 100) base = base.slice(0, 100)
  return base
}

export function buildCharacterExportFilename(
  card: Record<string, unknown>,
  id: string,
  ext: 'png' | 'json',
): string {
  return `${buildCharacterExportBasename(card, id)}.${ext}`
}

export function contentDispositionAttachment(filename: string): string {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''
  const ascii =
    filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '') ||
    `download${ext || '.bin'}`
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** 读取磁盘上的角色卡 PNG 字节（无则 null） */
export async function readCharacterPngBuffer(id: string): Promise<Buffer | null> {
  if (!isValidShortId(id)) return null
  const doc = await readOneFile(id)
  if (!doc) return null
  const pngPath = path.join(getCharactersDir(), `${id}.png`)
  try {
    return await readFile(pngPath)
  } catch {
    return null
  }
}

export interface CharacterImageFilesDto {
  fileIds: string[]
  items: Array<{
    fileId: string
    name: string
    kind: string
    mime: string
    size: number
    createdAt: string
    updatedAt: string
    contentUrl: string
    missing: boolean
  }>
  nameConflict: boolean
  duplicateNameKeys: string[]
}

export type PutCharacterImageFilesError =
  | 'character_not_found'
  | 'image_files_too_many'
  | 'image_files_name_conflict'

export async function getCharacterImageFiles(
  characterId: string,
): Promise<CharacterImageFilesDto | null> {
  if (!isValidShortId(characterId)) return null
  const id = characterId.trim().toLowerCase()
  const doc = await readOneFile(id)
  if (!doc) return null
  const idx = await loadOrRebuildIndex()
  const fileIds = normalizeImageFileIdList(
    idx.imageFilesByCharacterId?.[id] ?? [],
  )
  const metas = await loadMetasForFileIds(fileIds)
  const metaById = new Map(metas.map((m) => [m.fileId, m]))
  const conflicts = findDuplicateNamesInMetas(metas)
  const items = fileIds.map((fid) => {
    const m = metaById.get(fid)
    if (!m) {
      return {
        fileId: fid,
        name: '',
        kind: '',
        mime: '',
        size: 0,
        createdAt: '',
        updatedAt: '',
        contentUrl: fileContentUrl(fid),
        missing: true,
      }
    }
    return {
      fileId: m.fileId,
      name: m.name,
      kind: m.kind,
      mime: m.mime,
      size: m.size,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      contentUrl: fileContentUrl(m.fileId),
      missing: false,
    }
  })
  return {
    fileIds,
    items,
    nameConflict: conflicts.length > 0,
    duplicateNameKeys: conflicts.map((c) => c.nameKey),
  }
}

export async function putCharacterImageFiles(
  characterId: string,
  rawFileIds: unknown,
): Promise<
  | { ok: true; data: CharacterImageFilesDto }
  | { ok: false; error: PutCharacterImageFilesError; detail?: string }
> {
  if (!isValidShortId(characterId)) {
    return { ok: false, error: 'character_not_found' }
  }
  const id = characterId.trim().toLowerCase()
  const doc = await readOneFile(id)
  if (!doc) return { ok: false, error: 'character_not_found' }

  const requested = normalizeImageFileIdList(rawFileIds)
  if (requested.length > CHARACTER_IMAGE_FILES_MAX) {
    return { ok: false, error: 'image_files_too_many' }
  }

  // 库内已删的 fileId 自动剪除（不报 not_found），便于绑定页确认保存
  const metas = await loadMetasForFileIds(requested)
  const have = new Set(metas.map((m) => m.fileId))
  const fileIds = requested.filter((f) => have.has(f))

  const conflicts = findDuplicateNamesInMetas(metas)
  if (conflicts.length > 0) {
    return {
      ok: false,
      error: 'image_files_name_conflict',
      detail: conflicts.map((c) => c.nameKey).join(','),
    }
  }

  const idx = await loadOrRebuildIndex()
  const map = { ...(idx.imageFilesByCharacterId ?? {}) }
  if (fileIds.length === 0) delete map[id]
  else map[id] = fileIds
  idx.imageFilesByCharacterId = map
  await writeIndexFile(idx)

  const data = await getCharacterImageFiles(id)
  if (!data) return { ok: false, error: 'character_not_found' }
  return { ok: true, data }
}

/** 一次读 index，供多角色宏预加载 */
export async function getImageFilesByCharacterIdMap(): Promise<
  Record<string, string[]>
> {
  const idx = await loadOrRebuildIndex()
  return normalizeImageFilesByCharacterId(idx.imageFilesByCharacterId)
}

export async function getImageFileIdsForCharacter(
  characterId: string,
): Promise<string[]> {
  if (!isValidShortId(characterId)) return []
  const id = characterId.trim().toLowerCase()
  const map = await getImageFilesByCharacterIdMap()
  return map[id] ?? []
}

/** 从全部角色绑定中移除某 fileId；返回受影响角色数 */
export async function removeFileIdFromAllCharacterImageFiles(
  fileId: string,
): Promise<number> {
  if (!isValidShortId(fileId)) return 0
  const fid = fileId.trim().toLowerCase()
  const idx = await loadOrRebuildIndex()
  const map = { ...(idx.imageFilesByCharacterId ?? {}) }
  let touched = 0
  for (const [cid, list] of Object.entries(map)) {
    if (!Array.isArray(list)) continue
    const next = list.filter((x) => typeof x === 'string' && x !== fid)
    if (next.length === list.length) continue
    touched += 1
    if (next.length === 0) delete map[cid]
    else map[cid] = next
  }
  if (touched === 0) return 0
  idx.imageFilesByCharacterId = map
  await writeIndexFile(idx)
  return touched
}

/** 批量解析角色展示名（index.entries；缺失则跳过） */
export async function resolveCharacterNamesByIds(
  characterIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (characterIds.length === 0) return out
  const idx = await loadOrRebuildIndex()
  const byId = new Map(idx.entries.map((e) => [e.id, e.name]))
  for (const raw of characterIds) {
    if (!isValidShortId(raw)) continue
    const id = raw.trim().toLowerCase()
    const name = byId.get(id)
    if (typeof name === 'string' && name.trim()) out.set(id, name.trim())
  }
  return out
}
