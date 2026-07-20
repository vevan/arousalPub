/** 插件 Slash 命令注册表（S3）；内置 goto / @ 由 `composer-slash-catalog.ts` 提供 */

import type { ComposerSlashCommandSpec } from './composer-slash-catalog.js'

export interface SlashCommandContext {
  conversationId: string
  raw: string
  args: string
}

export type SlashCommandHandler = (
  ctx: SlashCommandContext,
) => void | Promise<void>

interface PluginSlashRegistration {
  spec: ComposerSlashCommandSpec
  handler: SlashCommandHandler
  /** 注册来源插件 id（scoped host 注入；用于按插件注销） */
  pluginId?: string
}

const pluginCommands = new Map<string, PluginSlashRegistration>()
/** pluginId → 已注册命令名（小写） */
const commandsByPluginId = new Map<string, Set<string>>()

export function registerComposerSlashCommand(
  name: string,
  handler: SlashCommandHandler,
  spec?: Omit<ComposerSlashCommandSpec, 'source' | 'id'> & {
    id?: string
    pluginId?: string
  },
): void {
  const key = name.trim().toLowerCase()
  if (!key) return
  const id = spec?.id?.trim() || name.trim()
  const pluginId = spec?.pluginId?.trim() || undefined

  const prev = pluginCommands.get(key)
  if (prev?.pluginId) {
    const set = commandsByPluginId.get(prev.pluginId)
    set?.delete(key)
    if (set && set.size === 0) commandsByPluginId.delete(prev.pluginId)
  }

  pluginCommands.set(key, {
    handler,
    pluginId,
    spec: {
      id,
      example: spec?.example ?? `/${id}`,
      descriptionKey: spec?.descriptionKey ?? 'chat.slash.commands.plugin.description',
      source: 'plugin',
    },
  })

  if (pluginId) {
    let set = commandsByPluginId.get(pluginId)
    if (!set) {
      set = new Set()
      commandsByPluginId.set(pluginId, set)
    }
    set.add(key)
  }
}

/** 注销某插件注册的全部 Composer slash（插件禁用 / 卸载时） */
export function unregisterComposerSlashCommandsForPlugin(pluginId: string): void {
  const id = pluginId.trim()
  if (!id) return
  const keys = commandsByPluginId.get(id)
  if (!keys) return
  for (const key of keys) {
    const reg = pluginCommands.get(key)
    if (reg?.pluginId === id) pluginCommands.delete(key)
  }
  commandsByPluginId.delete(id)
}

export function getComposerSlashPluginHandler(
  name: string,
): SlashCommandHandler | undefined {
  return pluginCommands.get(name.trim().toLowerCase())?.handler
}

export function listComposerSlashPluginSpecs(): ComposerSlashCommandSpec[] {
  return [...pluginCommands.values()].map((r) => r.spec)
}

export function listComposerSlashPluginCommands(): string[] {
  return [...pluginCommands.keys()].sort()
}

/** 单测用：清空插件 slash 注册表 */
export function clearComposerSlashPluginCommandsForTests(): void {
  pluginCommands.clear()
  commandsByPluginId.clear()
}
