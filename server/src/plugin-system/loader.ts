import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getCurrentUserId } from '../user-context.js'
import {
  getBundledPluginSourceDir,
  getGlobalPluginsDir,
  getInstalledPluginDir,
  getInstalledPluginServerEntry,
  getLegacyUserPluginDir,
  getLegacyUserPluginSettingsPath,
  getPluginUserDataDir,
  getPluginUserSettingsPath,
} from './paths.js'
import { migrateCuratedMemoryToPlotSummary } from './migrate-plot-summary.js'
import { readPluginRegistry, writePluginRegistry } from './registry.js'
import type {
  LoadedServerPlugin,
  PluginManageEntry,
  PluginRegistryDocument,
  PluginRegistryPublicEntry,
  PluginServerModule,
} from './types.js'
import { readPluginManifest } from './manifest.js'
import { assertValidPluginId } from './plugin-id.js'
import {
  pluginHasConversationSettingsSchema,
  pluginHasSettingsSchema,
  readMergedPluginUserSettings,
  writePluginUserSettings,
} from './settings.js'

const BUNDLED_PLUGIN_IDS = [
  'guidance-generate',
  'reply-complete-sound',
  'swipe-cleaner',
  'conversation-export',
  'plot-summary',
] as const

const BUNDLED_PLUGIN_ORDERS: Record<(typeof BUNDLED_PLUGIN_IDS)[number], number> = {
  'guidance-generate': 10,
  'reply-complete-sound': 20,
  'swipe-cleaner': 30,
  'conversation-export': 40,
  'plot-summary': 50,
}

const moduleCache = new Map<string, LoadedServerPlugin[]>()

let bundledPluginsSeeded = false
let bundledSeedInFlight: Promise<void> | null = null

async function importServerModule(
  entryPath: string,
): Promise<PluginServerModule | null> {
  if (!existsSync(entryPath)) return null
  try {
    const mod = (await import(
      pathToFileURL(entryPath).href
    )) as PluginServerModule
    return mod
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[plugin-loader] failed to import', entryPath, e)
    return null
  }
}

async function copyPluginPackage(srcDir: string, destDir: string): Promise<void> {
  const opts = { recursive: true, force: true } as const
  await mkdir(destDir, { recursive: true })
  await cp(
    path.join(srcDir, 'manifest.json'),
    path.join(destDir, 'manifest.json'),
    opts,
  )
  const distSrc = path.join(srcDir, 'dist')
  if (existsSync(distSrc)) {
    await cp(distSrc, path.join(destDir, 'dist'), opts)
  }
  const localesSrc = path.join(srcDir, 'locales')
  if (existsSync(localesSrc)) {
    await cp(localesSrc, path.join(destDir, 'locales'), opts)
  }
  const assetsSrc = path.join(srcDir, 'assets')
  if (existsSync(assetsSrc)) {
    await cp(assetsSrc, path.join(destDir, 'assets'), opts)
  }
}

/** 从仓库 plugins/{id}/ 全量覆盖已安装包（不删用户 settings 子目录） */
export async function seedBundledPlugins(): Promise<void> {
  if (bundledPluginsSeeded) return
  if (bundledSeedInFlight) {
    await bundledSeedInFlight
    return
  }

  bundledSeedInFlight = (async () => {
    await mkdir(getGlobalPluginsDir(), { recursive: true })

    for (const pluginId of BUNDLED_PLUGIN_IDS) {
      const src = getBundledPluginSourceDir(pluginId)
      if (!existsSync(path.join(src, 'manifest.json'))) {
        // eslint-disable-next-line no-console
        console.warn('[plugin-loader] bundled source missing:', pluginId, src)
        continue
      }
      try {
        await copyPluginPackage(src, getInstalledPluginDir(pluginId))
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[plugin-loader] bundled sync failed:', pluginId, e)
      }
    }
    bundledPluginsSeeded = true
  })()

  try {
    await bundledSeedInFlight
  } finally {
    bundledSeedInFlight = null
  }
}

/** 开发 / 强制同步后调用，允许下次 seedBundledPlugins 再跑 */
export function invalidateBundledPluginSeedCache(): void {
  bundledPluginsSeeded = false
  bundledSeedInFlight = null
}

async function ensureBundledRegistryEntries(userId: string): Promise<void> {
  const doc = await readPluginRegistry(userId)
  let changed = false
  for (const pluginId of BUNDLED_PLUGIN_IDS) {
    if (doc.plugins.some((p) => p.id === pluginId)) continue
    doc.plugins.push({
      id: pluginId,
      enabled: true,
      order: BUNDLED_PLUGIN_ORDERS[pluginId],
    })
    changed = true
  }
  if (!changed) return
  doc.plugins.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  await writePluginRegistry(doc, userId)
}

async function ensureBundledPluginUserSettings(userId: string): Promise<void> {
  for (const pluginId of BUNDLED_PLUGIN_IDS) {
    const settingsPath = getPluginUserSettingsPath(pluginId, userId)
    if (existsSync(settingsPath)) continue

    const userDir = getPluginUserDataDir(pluginId, userId)
    await mkdir(userDir, { recursive: true })

    const legacySettings = getLegacyUserPluginSettingsPath(pluginId, userId)
    if (existsSync(legacySettings)) {
      await cp(legacySettings, settingsPath)
      const legacySecrets = path.join(
        getLegacyUserPluginDir(pluginId, userId),
        'secrets',
      )
      const newSecrets = path.join(userDir, 'secrets')
      if (existsSync(legacySecrets) && !existsSync(newSecrets)) {
        await cp(legacySecrets, newSecrets, { recursive: true })
      }
      continue
    }

    const template = path.join(getBundledPluginSourceDir(pluginId), 'settings.json')
    try {
      if (existsSync(template)) {
        await cp(template, settingsPath)
      } else {
        await writeFile(settingsPath, '{"schemaVersion":1}\n', 'utf8')
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[plugin-loader] settings seed failed:', pluginId, userId, e)
    }
  }
}

/** 启动时：安装 bundled 包到 data/plugins，并为所有用户补 registry / settings */
export async function bootstrapBundledPluginsAtStartup(): Promise<void> {
  await seedBundledPlugins()
  const { readUsersIndex } = await import('../users-index.js')
  const index = await readUsersIndex()
  const userIds = new Set<string>()
  for (const user of index.users) {
    const uid = typeof user.id === 'string' ? user.id.trim() : ''
    if (uid) userIds.add(uid)
  }
  for (const uid of userIds) {
    await migrateCuratedMemoryToPlotSummary(uid)
    await ensureBundledRegistryEntries(uid)
    await ensureBundledPluginUserSettings(uid)
  }
}

/** 确保当前用户在每个插件目录下有独立 settings（及 secrets 迁移） */
export async function ensurePluginUserData(userId: string): Promise<void> {
  await seedBundledPlugins()
  await migrateCuratedMemoryToPlotSummary(userId)
  await ensureBundledRegistryEntries(userId)
  await ensureBundledPluginUserSettings(userId)
}

function cacheKey(userId: string): string {
  return userId
}

export async function loadEnabledServerPlugins(
  userId?: string,
): Promise<LoadedServerPlugin[]> {
  const uid = userId ?? getCurrentUserId()
  await ensurePluginUserData(uid)

  const key = cacheKey(uid)
  const cached = moduleCache.get(key)
  if (cached) return cached

  const registry = await readPluginRegistry(uid)
  const loaded: LoadedServerPlugin[] = []

  for (const entry of registry.plugins) {
    if (!entry.enabled) continue
    const entryPath = getInstalledPluginServerEntry(entry.id)
    const mod = await importServerModule(entryPath)
    if (!mod) continue
    loaded.push({ id: entry.id, order: entry.order, module: mod })
  }

  loaded.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  moduleCache.set(key, loaded)
  return loaded
}

export function invalidatePluginLoaderCache(userId?: string): void {
  const uid = userId ?? getCurrentUserId()
  moduleCache.delete(cacheKey(uid))
}

export async function listPublicPluginRegistry(
  userId?: string,
): Promise<PluginRegistryPublicEntry[]> {
  const uid = userId ?? getCurrentUserId()
  await ensurePluginUserData(uid)
  const registry = await readPluginRegistry(uid)
  const out: PluginRegistryPublicEntry[] = []
  for (const entry of registry.plugins) {
    if (!entry.enabled) continue
    const manifest = await readPluginManifest(entry.id)
    if (!manifest) continue
    const slots =
      manifest.ui?.slots
        ?.map((s) => (typeof s.name === 'string' ? s.name.trim() : ''))
        .filter((s) => s.length > 0) ?? []
    const webPath = `/api/plugins/${encodeURIComponent(entry.id)}/dist/web.mjs`
    out.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      order: entry.order,
      slots,
      webEntry: existsSync(
        path.join(getInstalledPluginDir(entry.id), 'dist', 'web.mjs'),
      )
        ? webPath
        : null,
    })
  }
  return out
}

export async function listPluginsManage(
  userId?: string,
): Promise<PluginManageEntry[]> {
  const uid = userId ?? getCurrentUserId()
  await ensurePluginUserData(uid)
  const registry = await readPluginRegistry(uid)
  const out: PluginManageEntry[] = []
  for (const entry of registry.plugins) {
    const manifest = await readPluginManifest(entry.id)
    if (!manifest) continue
    const slots =
      manifest.ui?.slots
        ?.map((s) => (typeof s.name === 'string' ? s.name.trim() : ''))
        .filter((s) => s.length > 0) ?? []
    const schema = manifest.settingsSchema ?? null
    const convSchema = manifest.conversationSettingsSchema ?? null
    out.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      enabled: entry.enabled,
      order: entry.order,
      hooks: manifest.hooks ?? [],
      slots,
      settingsSchema: schema,
      hasSettings: pluginHasSettingsSchema(schema),
      conversationSettingsSchema: convSchema,
      hasConversationSettings: pluginHasConversationSettingsSchema(convSchema),
    })
  }
  out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return out
}

export async function savePluginRegistry(
  doc: PluginRegistryDocument,
  userId?: string,
): Promise<PluginRegistryDocument> {
  const uid = userId ?? getCurrentUserId()
  const normalized: PluginRegistryDocument = {
    version: 1,
    plugins: [],
  }
  for (let i = 0; i < doc.plugins.length; i++) {
    const p = doc.plugins[i]!
    let id: string
    try {
      id = assertValidPluginId(p.id)
    } catch {
      throw new Error('invalid_plugin_id')
    }
    const manifest = await readPluginManifest(id)
    if (!manifest || manifest.id !== id) {
      throw new Error('plugin_registry_manifest_mismatch')
    }
    normalized.plugins.push({
      id,
      enabled: p.enabled !== false,
      order: Number.isFinite(p.order) ? Math.round(p.order) : (i + 1) * 10,
    })
  }
  normalized.plugins.sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )
  await writePluginRegistry(normalized, uid)
  invalidatePluginLoaderCache(uid)
  return normalized
}

export {
  readMergedPluginUserSettings,
  writePluginUserSettings,
}

export async function readPluginDistFile(
  pluginId: string,
  relPath: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  let id: string
  try {
    id = assertValidPluginId(pluginId)
  } catch {
    return null
  }
  const clean = relPath.replace(/^\/+/, '').replace(/\.\./g, '')
  if (!clean.startsWith('dist/')) return null
  const root = getInstalledPluginDir(id)
  const full = path.join(root, clean)
  if (!full.startsWith(root)) return null
  try {
    const body = await readFile(full)
    const contentType = clean.endsWith('.mjs')
      ? 'text/javascript; charset=utf-8'
      : 'application/octet-stream'
    return { body, contentType }
  } catch {
    return null
  }
}

const PLUGIN_LOCALE_IDS = new Set(['en', 'zh'])

export async function readPluginLocaleFile(
  pluginId: string,
  locale: string,
): Promise<{ body: Buffer } | null> {
  let id: string
  try {
    id = assertValidPluginId(pluginId)
  } catch {
    return null
  }
  const loc = locale.trim().toLowerCase()
  if (!PLUGIN_LOCALE_IDS.has(loc)) return null
  const root = getInstalledPluginDir(id)
  const full = path.join(root, 'locales', `${loc}.json`)
  if (!full.startsWith(root)) return null
  try {
    const body = await readFile(full)
    return { body }
  } catch {
    return null
  }
}
