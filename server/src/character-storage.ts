import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCharactersDir } from './config.js'
import { readChatList, resolvedCharacterIds } from './chat-storage.js'
import {
  embedCharaInPng,
  extractCardFromPng,
  isPngBuffer,
  normalizeTavernCardV2Data,
} from './character-png.js'
import { generateShortId, isValidShortId } from './short-id.js'

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
  systemPromptPreview: string
  tags: string[]
}

interface CharacterIndexFile {
  schemaVersion: 1
  generatedAt: string
  entries: CharacterIndexEntry[]
}

export interface CharacterListItem {
  id: string
  name: string
  summary: string
  systemPromptPreview: string
  tags: string[]
  updatedAt: string
  usedInConversationCount: number
}

export interface CharacterStoredDocument {
  schemaVersion: 1
  id: string
  importedAt: string
  updatedAt: string
  card: Record<string, unknown>
}

function nowIso(): string {
  return new Date().toISOString()
}

async function refCounts(): Promise<Map<string, number>> {
  const list = await readChatList()
  const counts = new Map<string, number>()
  for (const entry of list.conversations) {
    const ids = resolvedCharacterIds(
      entry as { characterIds?: string[] },
    )
    for (const cid of ids) {
      counts.set(cid, (counts.get(cid) ?? 0) + 1)
    }
  }
  return counts
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
    return raw as CharacterIndexFile
  } catch {
    return null
  }
}

async function writeIndexFile(data: CharacterIndexFile): Promise<void> {
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
  const ids = await listCharacterIdsOnDisk()
  const entries: CharacterIndexEntry[] = []
  for (const id of ids) {
    const doc = await readDocFromDiskForRebuild(id)
    if (!doc || doc.id !== id) continue
    entries.push(entryFromDoc(doc))
  }
  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt, 'en'))
  const file: CharacterIndexFile = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    entries,
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
  await writeIndexFile(idx)
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
  return true
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
}): Promise<{ items: CharacterListItem[]; total: number }> {
  await mkdir(getCharactersDir(), { recursive: true })
  const counts = await refCounts()
  const idx = await loadOrRebuildIndex()
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
    const usedN = counts.get(id) ?? 0
    rows.push({
      id,
      name: e.name,
      summary: e.summary,
      systemPromptPreview: e.systemPromptPreview,
      tags: e.tags,
      updatedAt,
      usedInConversationCount: usedN,
    })
  }

  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt, 'en'))

  const q = (params.search ?? '').trim().toLowerCase()
  const filter = params.filter ?? 'all'
  let filtered = rows
  if (q) {
    filtered = filtered.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q) ||
        r.systemPromptPreview.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }
  if (filter === 'used') {
    filtered = filtered.filter((r) => r.usedInConversationCount > 0)
  } else if (filter === 'unused') {
    filtered = filtered.filter((r) => r.usedInConversationCount === 0)
  }

  const total = filtered.length
  const offset = Math.max(0, Math.floor(params.offset) || 0)
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit) || 24))
  const items = filtered.slice(offset, offset + limit)
  return { items, total }
}

export async function readCharacterDocument(
  id: string,
): Promise<CharacterStoredDocument | null> {
  if (!isValidShortId(id)) return null
  return readOneFile(id)
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
