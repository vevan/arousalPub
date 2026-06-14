import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, getUserDataDir } from '../config.js'
import { getCurrentUserId } from '../user-context.js'
import { assertValidPluginId } from './plugin-id.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function findRepoRoot(): string {
  let cur = __dirname
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(cur, 'config.example.yaml'))) return cur
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return path.resolve(__dirname, '..', '..', '..')
}

const REPO_ROOT = findRepoRoot()

/** 全局插件根目录 `data/plugins/` */
export function getGlobalPluginsDir(): string {
  return path.join(DATA_DIR, 'plugins')
}

/** 全局旧注册表 `data/plugin-registry.json`（迁移用） */
export function getLegacyGlobalPluginRegistryPath(): string {
  return path.join(DATA_DIR, 'plugin-registry.json')
}

/** 分用户插件注册表 `data/{userId}/plugin-registry.json` */
export function getPluginRegistryPath(userId?: string): string {
  return path.join(
    getUserDataDir(userId ?? getCurrentUserId()),
    'plugin-registry.json',
  )
}

function assertUnderPluginsRoot(root: string, resolved: string): string {
  const normRoot = path.resolve(root) + path.sep
  const normResolved = path.resolve(resolved)
  if (!normResolved.startsWith(normRoot)) {
    throw new Error('invalid_plugin_path')
  }
  return normResolved
}

/** 已安装插件包 `data/plugins/<pluginId>/`（manifest、dist，全用户共用） */
export function getInstalledPluginDir(pluginId: string): string {
  const id = assertValidPluginId(pluginId)
  const root = getGlobalPluginsDir()
  return assertUnderPluginsRoot(root, path.join(root, id))
}

export function getInstalledPluginServerEntry(pluginId: string): string {
  return path.join(getInstalledPluginDir(pluginId), 'dist', 'server.mjs')
}

export function getInstalledPluginWebEntry(pluginId: string): string {
  return path.join(getInstalledPluginDir(pluginId), 'dist', 'web.mjs')
}

export function getInstalledPluginManifestPath(pluginId: string): string {
  return path.join(getInstalledPluginDir(pluginId), 'manifest.json')
}

/** 单用户插件数据 `data/plugins/<pluginId>/<userId>/` */
export function getPluginUserDataDir(
  pluginId: string,
  userId?: string,
): string {
  return path.join(
    getInstalledPluginDir(pluginId),
    userId ?? getCurrentUserId(),
  )
}

export function getPluginUserSettingsPath(
  pluginId: string,
  userId?: string,
): string {
  return path.join(getPluginUserDataDir(pluginId, userId), 'settings.json')
}

export function getPluginUserSecretsDir(
  pluginId: string,
  userId?: string,
): string {
  return path.join(getPluginUserDataDir(pluginId, userId), 'secrets')
}

/** 旧布局 `data/{userId}/plugins/<pluginId>/`（仅迁移用） */
export function getLegacyUserPluginDir(
  pluginId: string,
  userId: string,
): string {
  return path.join(getUserDataDir(userId), 'plugins', pluginId.trim())
}

export function getLegacyUserPluginSettingsPath(
  pluginId: string,
  userId: string,
): string {
  return path.join(getLegacyUserPluginDir(pluginId, userId), 'settings.json')
}

export function getLegacyPluginRegistryPath(userId: string): string {
  return path.join(getUserDataDir(userId), 'plugin-registry.json')
}

export function getPluginUserAssetsDir(
  pluginId: string,
  userId?: string,
): string {
  return path.join(getPluginUserDataDir(pluginId, userId), 'assets')
}

/** 仓库内打包插件源目录 `plugins/{id}/` */
export function getBundledPluginSourceDir(pluginId: string): string {
  return path.join(REPO_ROOT, 'plugins', pluginId.trim())
}
