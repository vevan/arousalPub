import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createKeyedSerialQueue } from '../keyed-serial-queue.js'
import { getPluginUserDataDir } from './paths.js'
import type { PluginDataApi } from './types.js'

/** 单文件写入上限（UTF-8 字节） */
export const PLUGIN_DATA_MAX_BYTES = 30 * 1024 * 1024

const pluginDataQueue = createKeyedSerialQueue()

export type PluginDataPathError =
  | 'plugin_id_required'
  | 'missing_conversation_id'
  | 'invalid_conversation_id'
  | 'invalid_plugin_data_path'
  | 'plugin_data_too_large'

export function pluginDataError(
  code: PluginDataPathError,
  status = 400,
): Error & { status: number } {
  return Object.assign(new Error(code), { status })
}

/**
 * 仅允许 scope 根下单层文件名（无路径分隔、无 `..`）。
 * 与 `list`（只列一层）能力对齐。
 */
export function assertSafePluginDataRelPath(relPath: string): string {
  const trimmed = typeof relPath === 'string' ? relPath.trim() : ''
  if (!trimmed) throw pluginDataError('invalid_plugin_data_path')
  if (trimmed.includes('\0')) throw pluginDataError('invalid_plugin_data_path')
  if (path.isAbsolute(trimmed)) throw pluginDataError('invalid_plugin_data_path')
  if (/[/\\]/.test(trimmed)) throw pluginDataError('invalid_plugin_data_path')
  if (trimmed === '.' || trimmed === '..') {
    throw pluginDataError('invalid_plugin_data_path')
  }
  // Windows drive-relative / UNC-ish
  if (/^[a-zA-Z]:/.test(trimmed)) throw pluginDataError('invalid_plugin_data_path')
  return trimmed
}

export function resolvePluginDataScopeDir(
  pluginId: string,
  userId: string,
  scope: 'global' | 'conversation',
  conversationId?: string,
): string {
  const pid = pluginId.trim()
  if (!pid) throw pluginDataError('plugin_id_required')
  const userDataDir = getPluginUserDataDir(pid, userId)
  const baseDataDir = path.join(userDataDir, 'data')

  if (scope === 'global') {
    return path.join(baseDataDir, 'global')
  }

  const cid = conversationId?.trim()
  if (!cid) throw pluginDataError('missing_conversation_id')

  const convRoot = path.join(baseDataDir, 'conversations')
  const scopeDir = path.join(convRoot, cid)
  const resolvedScope = path.resolve(scopeDir)
  const guard = path.resolve(convRoot) + path.sep
  if (!resolvedScope.startsWith(guard)) {
    throw pluginDataError('invalid_conversation_id')
  }
  return resolvedScope
}

export function resolvePluginDataFilePath(
  pluginId: string,
  userId: string,
  scope: 'global' | 'conversation',
  relPath: string,
  conversationId?: string,
): string {
  const safeName = assertSafePluginDataRelPath(relPath)
  const scopeDir = resolvePluginDataScopeDir(
    pluginId,
    userId,
    scope,
    conversationId,
  )
  const resolved = path.resolve(scopeDir, safeName)
  const guard = path.resolve(scopeDir) + path.sep
  if (!resolved.startsWith(guard)) {
    throw pluginDataError('invalid_plugin_data_path')
  }
  // Flat only: file must live directly under scopeDir
  if (path.dirname(resolved) !== path.resolve(scopeDir)) {
    throw pluginDataError('invalid_plugin_data_path')
  }
  return resolved
}

export function assertPluginDataContentSize(content: string): void {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > PLUGIN_DATA_MAX_BYTES) {
    throw pluginDataError('plugin_data_too_large', 413)
  }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, filePath)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

export function createPluginDataApi(opts: {
  pluginId: string
  userId: string
  assertPermission: () => Promise<void>
}): PluginDataApi {
  const { pluginId, userId, assertPermission } = opts

  /** list / read / write / delete 共用 scope 锁，避免 list 与写交叉看到半截文件 */
  function queueKeyForScope(
    scope: 'global' | 'conversation',
    conversationId?: string,
  ): string {
    const scopeDir = resolvePluginDataScopeDir(
      pluginId,
      userId,
      scope,
      conversationId,
    )
    return `scope:${path.resolve(scopeDir)}`
  }

  return {
    async list(scope, conversationId) {
      await assertPermission()
      const key = queueKeyForScope(scope, conversationId)
      return pluginDataQueue.run(key, async () => {
        const scopeDir = resolvePluginDataScopeDir(
          pluginId,
          userId,
          scope,
          conversationId,
        )
        if (!existsSync(scopeDir)) return []
        return readdirSync(scopeDir, { withFileTypes: true })
          .filter((d) => d.isFile())
          .map((d) => d.name)
      })
    },
    async read(scope, relPath, conversationId) {
      await assertPermission()
      const key = queueKeyForScope(scope, conversationId)
      return pluginDataQueue.run(key, async () => {
        const filePath = resolvePluginDataFilePath(
          pluginId,
          userId,
          scope,
          relPath,
          conversationId,
        )
        try {
          return await readFile(filePath, 'utf8')
        } catch (e) {
          const err = e as NodeJS.ErrnoException
          if (err.code === 'ENOENT') return null
          throw e
        }
      })
    },
    async write(scope, relPath, content, conversationId) {
      await assertPermission()
      assertPluginDataContentSize(content)
      const key = queueKeyForScope(scope, conversationId)
      return pluginDataQueue.run(key, async () => {
        assertPluginDataContentSize(content)
        const filePath = resolvePluginDataFilePath(
          pluginId,
          userId,
          scope,
          relPath,
          conversationId,
        )
        await writeFileAtomic(filePath, content)
      })
    },
    async delete(scope, relPath, conversationId) {
      await assertPermission()
      const key = queueKeyForScope(scope, conversationId)
      return pluginDataQueue.run(key, async () => {
        const filePath = resolvePluginDataFilePath(
          pluginId,
          userId,
          scope,
          relPath,
          conversationId,
        )
        try {
          await unlink(filePath)
        } catch (e) {
          const err = e as NodeJS.ErrnoException
          if (err.code === 'ENOENT') return
          throw e
        }
      })
    },
  }
}
