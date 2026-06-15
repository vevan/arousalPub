import type { ChatMessage } from './assemble-prompts.js'
import type { PromptMacroContext } from './prompt-macros/types.js'
import type { ChatPluginsBody, TurnPluginEntry } from './plugin-types.js'
import { createPluginServerHostApi } from './plugin-system/host-api.js'
import { loadEnabledServerPlugins } from './plugin-system/loader.js'
export interface AfterAssemblePromptsContext {
  messages: ChatMessage[]
  macroContext: PromptMacroContext
  plugins?: ChatPluginsBody | null
}

export async function applyPluginsAfterAssemblePrompts(
  ctx: AfterAssemblePromptsContext,
): Promise<ChatMessage[]> {
  const plugins = await loadEnabledServerPlugins()
  const api = createPluginServerHostApi()
  let messages = ctx.messages
  for (const p of plugins) {
    if (typeof p.module.afterAssemblePrompts !== 'function') continue
    const next = await p.module.afterAssemblePrompts(
      {
        pluginId: p.id,
        messages,
        macroContext: ctx.macroContext,
        plugins: ctx.plugins,
      },
      api,
    )
    if (Array.isArray(next)) messages = next
  }
  return messages
}

export async function resolveTurnPluginEntriesFromBody(
  plugins?: ChatPluginsBody | null,
): Promise<TurnPluginEntry[]> {
  const loaded = await loadEnabledServerPlugins()
  const api = createPluginServerHostApi()
  const out: TurnPluginEntry[] = []
  for (const p of loaded) {
    if (typeof p.module.resolveTurnPluginEntries !== 'function') continue
    const entries = await p.module.resolveTurnPluginEntries(plugins, api)
    if (Array.isArray(entries)) out.push(...entries)
  }
  return out
}

export async function resolveTurnPluginEntriesFromAssistant(
  assistantContent: string,
  opts?: {
    plugins?: ChatPluginsBody | null
    conversationId?: string
  },
): Promise<TurnPluginEntry[]> {
  const loaded = await loadEnabledServerPlugins()
  const api = createPluginServerHostApi()
  const out: TurnPluginEntry[] = []
  const ctx = {
    assistantContent,
    plugins: opts?.plugins,
    conversationId: opts?.conversationId,
  }
  for (const p of loaded) {
    if (typeof p.module.resolveTurnPluginEntriesFromAssistant !== 'function') {
      continue
    }
    const entries = await p.module.resolveTurnPluginEntriesFromAssistant(ctx, api)
    if (Array.isArray(entries)) out.push(...entries)
  }
  return out
}

export function mergeTurnPluginEntries(
  base: TurnPluginEntry[],
  extra: TurnPluginEntry[],
): TurnPluginEntry[] {
  let merged = [...base]
  for (const entry of extra) {
    merged = merged.filter((e) => e.pluginId !== entry.pluginId)
    merged.push(entry)
  }
  return merged
}
