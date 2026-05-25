import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, getPromptsDir, getUserDataDir } from './config.js'
import { DEFAULT_USER_ID, enterRequestUser } from './user-context.js'
import {
  legacyPromptsMonolithPath,
  writePromptsDocument,
  type PromptsDocument,
} from './prompts-file.js'

const LEGACY_USER_FILES = ['api-settings.json', 'api-keys.json', 'prompts.json'] as const
const LEGACY_USER_DIRS = ['chats', 'characters', 'lorebooks'] as const

function userDir(userId: string): string {
  return path.join(DATA_DIR, userId)
}

function hasLegacyFlatLayout(): boolean {
  for (const f of LEGACY_USER_FILES) {
    if (existsSync(path.join(DATA_DIR, f))) return true
  }
  for (const d of LEGACY_USER_DIRS) {
    if (existsSync(path.join(DATA_DIR, d))) return true
  }
  return false
}

async function moveFileIfAbsent(from: string, to: string): Promise<void> {
  if (!existsSync(from)) return
  await mkdir(path.dirname(to), { recursive: true })
  if (existsSync(to)) return
  await rename(from, to)
}

/** 将源目录下尚未存在于目标处的条目迁入目标（用于部分迁移后的补全） */
async function mergeDirInto(from: string, to: string): Promise<void> {
  if (!existsSync(from)) return
  await mkdir(to, { recursive: true })
  const entries = await readdir(from, { withFileTypes: true })
  for (const ent of entries) {
    const src = path.join(from, ent.name)
    const dst = path.join(to, ent.name)
    if (ent.isDirectory()) {
      await mergeDirInto(src, dst)
      continue
    }
    if (!existsSync(dst)) await rename(src, dst)
  }
  const left = await readdir(from).catch(() => [] as string[])
  if (left.length === 0) await rm(from, { recursive: true, force: true })
}

interface ChatListEntry {
  conversationId: string
  updatedAt: string
  [key: string]: unknown
}

interface ChatListFile {
  schemaVersion: number
  conversations: ChatListEntry[]
}

interface CharacterIndexEntry {
  id: string
  updatedAt: string
  [key: string]: unknown
}

interface CharacterIndexFile {
  schemaVersion: number
  generatedAt?: string
  entries: CharacterIndexEntry[]
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

async function mergeChatListIndexes(legacyPath: string, destPath: string): Promise<void> {
  const legacy = await readJsonFile<ChatListFile>(legacyPath)
  if (!legacy?.conversations?.length) return
  const dest =
    (await readJsonFile<ChatListFile>(destPath)) ?? {
      schemaVersion: 1,
      conversations: [],
    }
  const byId = new Map<string, ChatListEntry>()
  for (const e of dest.conversations) {
    if (e?.conversationId) byId.set(e.conversationId, e)
  }
  for (const e of legacy.conversations) {
    if (!e?.conversationId) continue
    const cur = byId.get(e.conversationId)
    if (!cur || String(e.updatedAt) > String(cur.updatedAt)) {
      byId.set(e.conversationId, { ...cur, ...e })
    }
  }
  const merged: ChatListFile = {
    schemaVersion: 1,
    conversations: [...byId.values()].sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt)),
    ),
  }
  await mkdir(path.dirname(destPath), { recursive: true })
  await writeFile(destPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  await rm(legacyPath, { force: true })
  // eslint-disable-next-line no-console
  console.log(`[migrate] merged chat.index.json → ${destPath}`)
}

async function mergeCharacterIndexes(legacyPath: string, destPath: string): Promise<void> {
  const legacy = await readJsonFile<CharacterIndexFile>(legacyPath)
  if (!legacy?.entries?.length) return
  const dest =
    (await readJsonFile<CharacterIndexFile>(destPath)) ?? {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      entries: [],
    }
  const byId = new Map<string, CharacterIndexEntry>()
  for (const e of dest.entries) {
    if (e?.id) byId.set(e.id, e)
  }
  for (const e of legacy.entries) {
    if (!e?.id) continue
    const cur = byId.get(e.id)
    if (!cur || String(e.updatedAt) > String(cur.updatedAt)) {
      byId.set(e.id, { ...cur, ...e })
    }
  }
  const merged: CharacterIndexFile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entries: [...byId.values()],
  }
  await mkdir(path.dirname(destPath), { recursive: true })
  await writeFile(destPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  await rm(legacyPath, { force: true })
  // eslint-disable-next-line no-console
  console.log(`[migrate] merged characters/index.json → ${destPath}`)
}

/** 删除根目录下已迁入 default-user 的遗留目录 */
async function removeLegacyRootDirs(): Promise<void> {
  for (const d of LEGACY_USER_DIRS) {
    const legacy = path.join(DATA_DIR, d)
    if (!existsSync(legacy)) continue
    await rm(legacy, { recursive: true, force: true })
    // eslint-disable-next-line no-console
    console.log(`[migrate] removed legacy data/${d}/`)
  }
}

/** 将 `data/*` 平铺布局迁入 `data/default-user/` */
async function migrateFlatDataToDefaultUser(): Promise<void> {
  if (!hasLegacyFlatLayout()) return
  const dest = userDir(DEFAULT_USER_ID)
  await mkdir(dest, { recursive: true })
  // eslint-disable-next-line no-console
  console.log(`[migrate] merging legacy data/ → data/${DEFAULT_USER_ID}/`)
  for (const f of LEGACY_USER_FILES) {
    await moveFileIfAbsent(path.join(DATA_DIR, f), path.join(dest, f))
  }
  for (const d of LEGACY_USER_DIRS) {
    await mergeDirInto(path.join(DATA_DIR, d), path.join(dest, d))
  }
  const legacyChatsIndex = path.join(DATA_DIR, 'chats', 'chat.index.json')
  const destChatsIndex = path.join(dest, 'chats', 'chat.index.json')
  if (existsSync(legacyChatsIndex)) {
    await mergeChatListIndexes(legacyChatsIndex, destChatsIndex)
  }
  const legacyCharIndex = path.join(DATA_DIR, 'characters', 'index.json')
  const destCharIndex = path.join(dest, 'characters', 'index.json')
  if (existsSync(legacyCharIndex)) {
    await mergeCharacterIndexes(legacyCharIndex, destCharIndex)
  }
  await removeLegacyRootDirs()
}

async function listUserIds(): Promise<string[]> {
  const names = await readdir(DATA_DIR).catch(() => [] as string[])
  const ids: string[] = []
  for (const name of names) {
    const full = path.join(DATA_DIR, name)
    try {
      const st = await stat(full)
      if (!st.isDirectory()) continue
    } catch {
      continue
    }
    if (name === 'README.md') continue
    ids.push(name)
  }
  if (!ids.includes(DEFAULT_USER_ID)) ids.unshift(DEFAULT_USER_ID)
  return [...new Set(ids)]
}

/** 将各用户目录下的 `prompts.json` 拆到 `prompts/` */
async function migrateAllUsersPrompts(): Promise<void> {
  const users = await listUserIds()
  for (const uid of users) {
    enterRequestUser(uid)
    const monolith = legacyPromptsMonolithPath()
    if (!existsSync(monolith)) continue
    try {
      const raw = await readFile(monolith, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PromptsDocument>
      if (!Array.isArray(parsed.presets) || typeof parsed.activePresetId !== 'string') {
        continue
      }
      const doc: PromptsDocument = {
        version: 3,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
        activePresetId: parsed.activePresetId,
        presets: parsed.presets,
      }
      await writePromptsDocument(doc)
      await rm(monolith, { force: true })
      // eslint-disable-next-line no-console
      console.log(`[migrate] prompts.json → prompts/ for user ${uid}`)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[migrate] prompts split failed for ${uid}:`, e)
    }
  }
}

export async function migrateDataLayoutIfNeeded(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await migrateFlatDataToDefaultUser()
  enterRequestUser(DEFAULT_USER_ID)
  await mkdir(getUserDataDir(), { recursive: true })
  await mkdir(getPromptsDir(), { recursive: true })
  await migrateAllUsersPrompts()
}

/** 命令行：`npm run migrate:data` */
async function runCli(): Promise<void> {
  await migrateDataLayoutIfNeeded()
  // eslint-disable-next-line no-console
  console.log('[migrate] finished')
}

const isCli =
  typeof process.argv[1] === 'string' &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isCli) {
  runCli().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
