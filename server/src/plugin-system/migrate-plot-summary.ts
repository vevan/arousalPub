import { existsSync } from 'node:fs'
import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getChatsRoot } from '../config.js'
import { isValidConversationId } from '../conversation-id.js'
import {
  getInstalledPluginDir,
  getPluginUserDataDir,
} from './paths.js'
import { readPluginRegistry, writePluginRegistry } from './registry.js'

const LEGACY_PLUGIN_ID = 'curated-memory'
const PLUGIN_ID = 'plot-summary'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

async function migratePluginUserData(userId: string): Promise<void> {
  const legacyDir = getPluginUserDataDir(LEGACY_PLUGIN_ID, userId)
  const nextDir = getPluginUserDataDir(PLUGIN_ID, userId)
  if (!existsSync(legacyDir) || existsSync(nextDir)) return
  await cp(legacyDir, nextDir, { recursive: true })
}

async function migratePluginRegistry(userId: string): Promise<void> {
  const doc = await readPluginRegistry(userId)
  const legacy = doc.plugins.find((p) => p.id === LEGACY_PLUGIN_ID)
  const current = doc.plugins.find((p) => p.id === PLUGIN_ID)
  if (!legacy || current) return
  doc.plugins = doc.plugins.map((p) =>
    p.id === LEGACY_PLUGIN_ID ? { ...p, id: PLUGIN_ID } : p,
  )
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

/** 一次性：`curated-memory` → `plot-summary`（registry、用户 settings、对话 pluginSettings） */
export async function migrateCuratedMemoryToPlotSummary(
  userId: string,
): Promise<void> {
  const uid = userId.trim()
  if (!uid) return

  const legacyInstalled = getInstalledPluginDir(LEGACY_PLUGIN_ID)
  const hasLegacy =
    existsSync(legacyInstalled) ||
    existsSync(getPluginUserDataDir(LEGACY_PLUGIN_ID, uid))

  if (!hasLegacy) return

  await migratePluginUserData(uid)
  await migratePluginRegistry(uid)
  await migrateConversationIndexes(uid)
}
