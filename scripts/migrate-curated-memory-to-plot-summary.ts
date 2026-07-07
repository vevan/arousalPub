/**
 * 一次性：`curated-memory` → `plot-summary`（registry、用户 settings、对话 pluginSettings）
 *
 * 运行：
 *   node --import tsx scripts/migrate-curated-memory-to-plot-summary.ts
 *   node --import tsx scripts/migrate-curated-memory-to-plot-summary.ts --user <userId>
 */
import { existsSync } from 'node:fs'
import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getChatsRoot } from '../server/src/config.js'
import { isValidConversationId } from '../server/src/conversation-id.js'
import {
  getInstalledPluginDir,
  getPluginUserDataDir,
} from '../server/src/plugin-system/paths.js'
import {
  readPluginRegistry,
  writePluginRegistry,
} from '../server/src/plugin-system/registry.js'

const LEGACY_PLUGIN_ID = 'curated-memory'
const PLUGIN_ID = 'plot-summary'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

async function migratePluginUserData(userId: string): Promise<void> {
  const legacyDir = getPluginUserDataDir(LEGACY_PLUGIN_ID, userId)
  const nextDir = getPluginUserDataDir(PLUGIN_ID, userId)
  if (!existsSync(legacyDir)) return
  if (!existsSync(nextDir)) {
    await cp(legacyDir, nextDir, { recursive: true })
    return
  }
  const legacySettings = path.join(legacyDir, 'settings.json')
  const nextSettings = path.join(nextDir, 'settings.json')
  if (!existsSync(legacySettings) || existsSync(nextSettings)) return
  await cp(legacySettings, nextSettings)
}

async function migratePluginRegistry(userId: string): Promise<void> {
  const doc = await readPluginRegistry(userId)
  const legacy = doc.plugins.find((p) => p.id === LEGACY_PLUGIN_ID)
  if (!legacy) return

  const withoutLegacy = doc.plugins.filter((p) => p.id !== LEGACY_PLUGIN_ID)
  const current = withoutLegacy.find((p) => p.id === PLUGIN_ID)
  if (!current) {
    withoutLegacy.push({ ...legacy, id: PLUGIN_ID })
  } else if (legacy.enabled && !current.enabled) {
    current.enabled = true
  }
  doc.plugins = withoutLegacy
  doc.plugins.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  await writePluginRegistry(doc, userId)
}

async function walkConversationIndexFiles(
  dir: string,
  acc: string[],
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      await walkConversationIndexFiles(full, acc)
    } else if (ent.isFile() && ent.name === 'index.json') {
      acc.push(full)
    }
  }
}

function migrateConversationIndexDoc(
  parsed: Record<string, unknown>,
): boolean {
  let changed = false

  const pluginSettings = parsed.pluginSettings
  if (isPlainObject(pluginSettings) && LEGACY_PLUGIN_ID in pluginSettings) {
    const legacyBag = pluginSettings[LEGACY_PLUGIN_ID]
    if (!isPlainObject(pluginSettings[PLUGIN_ID]) && isPlainObject(legacyBag)) {
      pluginSettings[PLUGIN_ID] = legacyBag
    }
    delete pluginSettings[LEGACY_PLUGIN_ID]
    if (Object.keys(pluginSettings).length === 0) {
      delete parsed.pluginSettings
    }
    changed = true
  }

  const apiPreset = parsed.apiPreset
  if (isPlainObject(apiPreset)) {
    const plugins = apiPreset.plugins
    if (isPlainObject(plugins) && LEGACY_PLUGIN_ID in plugins) {
      const legacyBinding = plugins[LEGACY_PLUGIN_ID]
      if (!isPlainObject(plugins[PLUGIN_ID]) && isPlainObject(legacyBinding)) {
        plugins[PLUGIN_ID] = legacyBinding
      }
      delete plugins[LEGACY_PLUGIN_ID]
      if (Object.keys(plugins).length === 0) {
        delete apiPreset.plugins
      }
      changed = true
    }
  }

  return changed
}

async function conversationHasLegacyPluginSettings(
  userId: string,
): Promise<boolean> {
  const root = getChatsRoot(userId)
  if (!existsSync(root)) return false

  const indexPaths: string[] = []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return false
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || !isValidConversationId(ent.name)) continue
    await walkConversationIndexFiles(path.join(root, ent.name), indexPaths)
  }

  for (const filePath of indexPaths) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'))
    } catch {
      continue
    }
    if (!isPlainObject(parsed)) continue
    const pluginSettings = parsed.pluginSettings
    if (isPlainObject(pluginSettings) && LEGACY_PLUGIN_ID in pluginSettings) {
      return true
    }
    const apiPreset = parsed.apiPreset
    if (isPlainObject(apiPreset)) {
      const plugins = apiPreset.plugins
      if (isPlainObject(plugins) && LEGACY_PLUGIN_ID in plugins) {
        return true
      }
    }
  }
  return false
}

async function migrateConversationIndexes(userId: string): Promise<void> {
  const root = getChatsRoot(userId)
  if (!existsSync(root)) return

  const indexPaths: string[] = []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || !isValidConversationId(ent.name)) continue
    await walkConversationIndexFiles(path.join(root, ent.name), indexPaths)
  }

  for (const filePath of indexPaths) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'))
    } catch {
      continue
    }
    if (!isPlainObject(parsed)) continue
    if (!migrateConversationIndexDoc(parsed)) continue
    await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  }
}

async function userNeedsMigration(userId: string): Promise<boolean> {
  const uid = userId.trim()
  if (!uid) return false

  if (existsSync(getInstalledPluginDir(LEGACY_PLUGIN_ID))) return true
  if (existsSync(getPluginUserDataDir(LEGACY_PLUGIN_ID, uid))) return true

  const doc = await readPluginRegistry(uid)
  if (doc.plugins.some((p) => p.id === LEGACY_PLUGIN_ID)) return true

  return conversationHasLegacyPluginSettings(uid)
}

export async function migrateCuratedMemoryToPlotSummary(
  userId: string,
): Promise<void> {
  const uid = userId.trim()
  if (!uid) return
  if (!(await userNeedsMigration(uid))) return

  await migratePluginUserData(uid)
  await migratePluginRegistry(uid)
  await migrateConversationIndexes(uid)
}

async function main() {
  const args = process.argv.slice(2)
  const userFlag = args.indexOf('--user')
  if (userFlag >= 0) {
    const userId = args[userFlag + 1]?.trim()
    if (!userId) {
      console.error('Usage: --user <userId>')
      process.exit(1)
    }
    await migrateCuratedMemoryToPlotSummary(userId)
    console.log('[migrate] done for user', userId)
    return
  }

  const { readUsersIndex } = await import('../server/src/users-index.js')
  const index = await readUsersIndex()
  for (const user of index.users) {
    const uid = typeof user.id === 'string' ? user.id.trim() : ''
    if (!uid) continue
    await migrateCuratedMemoryToPlotSummary(uid)
    console.log('[migrate] processed user', uid)
  }
  console.log('[migrate] all users done')
}

const entry = path.resolve(fileURLToPath(import.meta.url))
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
