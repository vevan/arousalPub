import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getCurrentUserId } from '../user-context.js'
import {
  getBundledPluginSourceDir,
  getGlobalPluginsDir,
  getInstalledPluginDir,
  getInstalledPluginManifestPath,
  getInstalledPluginServerEntry,
  getLegacyUserPluginDir,
  getLegacyUserPluginSettingsPath,
  getPluginUserDataDir,
  getPluginUserSettingsPath,
} from './paths.js'
import { readPluginRegistry, writePluginRegistry } from './registry.js'
import type {
  LoadedServerPlugin,
  PluginManageEntry,
  PluginRegistryDocument,
  PluginRegistryPublicEntry,
  PluginServerModule,
} from './types.js'
import { readPluginManifest } from './manifest.js'
import {
  pluginHasSettingsSchema,
  readMergedPluginUserSettings,
  writePluginUserSettings,
} from './settings.js'

const BUNDLED_PLUGIN_IDS = ['guidance-generate', 'reply-complete-sound'] as const

const BUNDLED_PLUGIN_ORDERS: Record<(typeof BUNDLED_PLUGIN_IDS)[number], number> = {
  'guidance-generate': 10,
  'reply-complete-sound': 20,
}

const moduleCache = new Map<string, LoadedServerPlugin[]>()

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
  await mkdir(destDir, { recursive: true })
  await cp(
    path.join(srcDir, 'manifest.json'),
    path.join(destDir, 'manifest.json'),
  )
  const distSrc = path.join(srcDir, 'dist')
  if (existsSync(distSrc)) {
    await cp(distSrc, path.join(destDir, 'dist'), { recursive: true })
  }
  const localesSrc = path.join(srcDir, 'locales')
  if (existsSync(localesSrc)) {
    await cp(localesSrc, path.join(destDir, 'locales'), { recursive: true })
  }
  const assetsSrc = path.join(srcDir, 'assets')
  if (existsSync(assetsSrc)) {
    await cp(assetsSrc, path.join(destDir, 'assets'), { recursive: true })
  }
}

async function ensureInstalledPluginAssets(pluginId: string): Promise<void> {
  const dest = getInstalledPluginDir(pluginId)
  const src = getBundledPluginSourceDir(pluginId)
  if (!existsSync(path.join(src, 'manifest.json'))) return

  if (!existsSync(getInstalledPluginManifestPath(pluginId))) {
    await copyPluginPackage(src, dest)
    return
  }

  const distSrc = path.join(src, 'dist')
  const distDest = path.join(dest, 'dist')
  if (existsSync(distSrc) && !existsSync(path.join(distDest, 'server.mjs'))) {
    await cp(distSrc, distDest, { recursive: true })
  }

  const localesSrc = path.join(src, 'locales')
  const localesDest = path.join(dest, 'locales')
  if (existsSync(localesSrc)) {
    await cp(localesSrc, localesDest, { recursive: true })
  }

  const assetsSrc = path.join(src, 'assets')
  const assetsDest = path.join(dest, 'assets')
  if (existsSync(assetsSrc)) {
    await cp(assetsSrc, assetsDest, { recursive: true })
  }

  const manifestSrc = path.join(src, 'manifest.json')
  if (existsSync(manifestSrc)) {
    await cp(manifestSrc, path.join(dest, 'manifest.json'))
  }
}

/** 全局安装 bundled 插件包（manifest + dist + locales + assets） */
export async function seedBundledPlugins(): Promise<void> {
  await mkdir(getGlobalPluginsDir(), { recursive: true })

  for (const pluginId of BUNDLED_PLUGIN_IDS) {
    if (existsSync(getInstalledPluginManifestPath(pluginId))) {
      await ensureInstalledPluginAssets(pluginId)
      continue
    }

    const legacyGlobal = getLegacyUserPluginDir(pluginId, '00000000')
    if (existsSync(path.join(legacyGlobal, 'manifest.json'))) {
      await copyPluginPackage(legacyGlobal, getInstalledPluginDir(pluginId))
      await ensureInstalledPluginAssets(pluginId)
      continue
    }

    const src = getBundledPluginSourceDir(pluginId)
    if (!existsSync(path.join(src, 'manifest.json'))) continue
    await copyPluginPackage(src, getInstalledPluginDir(pluginId))
  }
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

/** 确保当前用户在每个插件目录下有独立 settings（及 secrets 迁移） */
export async function ensurePluginUserData(userId: string): Promise<void> {
  await seedBundledPlugins()
  await ensureBundledRegistryEntries(userId)

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
    if (existsSync(template)) {
      await cp(template, settingsPath)
    } else {
      await writeFile(settingsPath, '{"schemaVersion":1}\n', 'utf8')
    }
  }
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
    plugins: doc.plugins
      .map((p, i) => ({
        id: p.id.trim(),
        enabled: p.enabled !== false,
        order: Number.isFinite(p.order) ? Math.round(p.order) : (i + 1) * 10,
      }))
      .filter((p) => p.id.length > 0),
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
  const id = pluginId.trim()
  const clean = relPath.replace(/^\/+/, '').replace(/\.\./g, '')
  if (!id || !clean.startsWith('dist/')) return null
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
  const id = pluginId.trim()
  const loc = locale.trim().toLowerCase()
  if (!id || !PLUGIN_LOCALE_IDS.has(loc)) return null
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
