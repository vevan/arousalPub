/** 插件 Slash 命令注册表（S3）；内置 goto / @ 由宿主 `composer-slash.ts` 处理 */

export interface SlashCommandContext {
  conversationId: string
  raw: string
  args: string
}

export type SlashCommandHandler = (
  ctx: SlashCommandContext,
) => void | Promise<void>

const pluginHandlers = new Map<string, SlashCommandHandler>()

export function registerComposerSlashCommand(
  name: string,
  handler: SlashCommandHandler,
): void {
  const key = name.trim().toLowerCase()
  if (!key) return
  pluginHandlers.set(key, handler)
}

export function getComposerSlashPluginHandler(
  name: string,
): SlashCommandHandler | undefined {
  return pluginHandlers.get(name.trim().toLowerCase())
}

export function listComposerSlashPluginCommands(): string[] {
  return [...pluginHandlers.keys()].sort()
}
