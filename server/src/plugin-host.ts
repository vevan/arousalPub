export { mergePluginPromptInjectionsIntoMessages } from './plugin-prompt-injection-merge.js'
export type { PluginPromptInjectionSpan } from './plugin-prompt-injection-merge.js'
import type { ChatMessage } from './assemble-prompts.js'
import type { PromptMacroContext } from './prompt-macros/types.js'
import type { ChatPluginsBody, TurnPluginEntry } from './plugin-types.js'
import { countChatMessagesTokens } from './token-count.js'
import { createPluginServerHostApi } from './plugin-system/host-api.js'
import {
  loadEnabledServerPlugins,
} from './plugin-system/loader.js'
import type { LoadedServerPlugin } from './plugin-system/types.js'

export type PluginAssembleAdditionCache = Map<string, ChatMessage[] | null>

export interface PluginAssembleRuntime {
  plugins: LoadedServerPlugin[]
  api: ReturnType<typeof createPluginServerHostApi>
}

export interface AfterAssemblePromptsContext {
  messages?: ChatMessage[]
  macroContext: PromptMacroContext
  plugins?: ChatPluginsBody | null
  tokenModel?: string
  additionCache?: PluginAssembleAdditionCache
  assembleRuntime?: PluginAssembleRuntime
}

async function ensureAssembleRuntime(
  ctx: AfterAssemblePromptsContext,
): Promise<PluginAssembleRuntime> {
  if (ctx.assembleRuntime) return ctx.assembleRuntime
  ctx.assembleRuntime = {
    plugins: await loadEnabledServerPlugins(),
    api: createPluginServerHostApi(),
  }
  return ctx.assembleRuntime
}

async function resolvePluginAddition(
  pluginId: string,
  module: {
    resolveAfterAssemblePromptsAddition?: (
      ctx: {
        pluginId: string
        macroContext: PromptMacroContext
        plugins?: ChatPluginsBody | null
      },
      api: ReturnType<typeof createPluginServerHostApi>,
    ) => ChatMessage[] | null | Promise<ChatMessage[] | null>
  },
  ctx: AfterAssemblePromptsContext,
  api: ReturnType<typeof createPluginServerHostApi>,
  cache?: PluginAssembleAdditionCache,
): Promise<ChatMessage[] | null> {
  if (cache?.has(pluginId)) {
    return cache.get(pluginId) ?? null
  }
  if (typeof module.resolveAfterAssemblePromptsAddition !== 'function') {
    cache?.set(pluginId, null)
    return null
  }
  const addition = await module.resolveAfterAssemblePromptsAddition(
    {
      pluginId,
      macroContext: ctx.macroContext,
      plugins: ctx.plugins,
    },
    api,
  )
  const normalized = Array.isArray(addition) && addition.length > 0 ? addition : null
  cache?.set(pluginId, normalized)
  return normalized
}

/** 插件 afterAssemble 追加内容的 token 预留（不参与 budget trim 裁切） */
export async function estimatePluginsAfterAssembleTokenReserve(
  ctx: AfterAssemblePromptsContext,
): Promise<number> {
  const cache = ctx.additionCache ?? new Map<string, ChatMessage[] | null>()
  if (!ctx.additionCache) ctx.additionCache = cache

  const { plugins, api } = await ensureAssembleRuntime(ctx)
  let total = 0
  for (const p of plugins) {
    const addition = await resolvePluginAddition(p.id, p.module, ctx, api, cache)
    if (addition?.length) {
      total += countChatMessagesTokens(addition, { model: ctx.tokenModel })
    }
  }
  return total
}

export async function applyPluginsAfterAssemblePrompts(
  ctx: AfterAssemblePromptsContext,
): Promise<ChatMessage[]> {
  const cache = ctx.additionCache ?? new Map<string, ChatMessage[] | null>()
  if (!ctx.additionCache) ctx.additionCache = cache

  const { plugins, api } = await ensureAssembleRuntime(ctx)
  let messages = ctx.messages ?? []

  for (const p of plugins) {
    const addition = await resolvePluginAddition(p.id, p.module, ctx, api, cache)
    if (addition?.length) {
      messages = [...messages, ...addition]
      continue
    }
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
