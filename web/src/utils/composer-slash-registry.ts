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
}

const pluginCommands = new Map<string, PluginSlashRegistration>()

export function registerComposerSlashCommand(
  name: string,
  handler: SlashCommandHandler,
  spec?: Omit<ComposerSlashCommandSpec, 'source' | 'id'> & { id?: string },
): void {
  const key = name.trim().toLowerCase()
  if (!key) return
  const id = spec?.id?.trim() || name.trim()
  pluginCommands.set(key, {
    handler,
    spec: {
      id,
      example: spec?.example ?? `/${id}`,
      descriptionKey: spec?.descriptionKey ?? 'chat.slash.commands.plugin.description',
      source: 'plugin',
    },
  })
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
