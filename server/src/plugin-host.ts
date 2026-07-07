import type { ChatMessage } from './assemble-prompts.js'
import type { PromptMacroContext } from './prompt-macros/types.js'
import type { ChatPluginsBody, TurnPluginEntry } from './plugin-types.js'
import { countChatMessagesTokens } from './token-count.js'
import { createPluginServerHostApi } from './plugin-system/host-api.js'
import {
  loadEnabledServerPlugins,
} from './plugin-system/loader.js'
import type { LoadedServerPlugin } from './plugin-system/types.js'
import {
  mergePluginPromptInjectionsIntoMessages,
  resolvePluginInjectionSpan,
  type PluginPromptInjectionSpan,
} from './plugin-prompt-injection-merge.js'
import {
  parsePluginPromptInjections,
  type PluginPromptInjection,
} from './shared/plugin-prompt-injection.js'

export { mergePluginPromptInjectionsIntoMessages } from './plugin-prompt-injection-merge.js'
export type { PluginPromptInjectionSpan } from './plugin-prompt-injection-merge.js'
export { resolvePluginInjectionSpan } from './plugin-prompt-injection-merge.js'

/** legacy `ChatMessage[]` addition 在迁描述符前映射为 depth 0 · order 999 */
const LEGACY_CHAT_INJECTION_ORDER = 999

export type PluginAssembleAdditionResolved =
  | { kind: 'injections'; injections: PluginPromptInjection[] }
  | { kind: 'legacy'; messages: ChatMessage[] }

export type PluginAssembleAdditionCache = Map<
  string,
  PluginAssembleAdditionResolved | null
>

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
  /** regex 后 messages 内 history 段（优先使用；否则由 trimmedHistoryMessages 推算） */
  injectionSpan?: PluginPromptInjectionSpan
  /** budget trim 后 history messages，与 regex 后 messages 对齐 */
  trimmedHistoryMessages?: ChatMessage[]
}

function normalizeHookAddition(raw: unknown): PluginAssembleAdditionResolved | null {
  const injections = parsePluginPromptInjections(raw)
  if (injections) {
    return { kind: 'injections', injections }
  }
  if (!Array.isArray(raw) || raw.length === 0) return null
  const messages: ChatMessage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const role = (item as ChatMessage).role
    const content = (item as ChatMessage).content
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      return null
    }
    if (typeof content !== 'string' || !content.trim()) continue
    messages.push({ role, content })
  }
  if (messages.length === 0) return null
  return { kind: 'legacy', messages }
}

function legacyMessagesToInjections(
  messages: ChatMessage[],
  pluginOrder: number,
): PluginPromptInjection[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    position: {
      kind: 'chat' as const,
      depth: 0,
      order: LEGACY_CHAT_INJECTION_ORDER,
      injectionOrder: pluginOrder,
    },
  }))
}

export function additionToInjections(
  resolved: PluginAssembleAdditionResolved,
  pluginOrder: number,
): PluginPromptInjection[] {
  if (resolved.kind === 'injections') return resolved.injections
  return legacyMessagesToInjections(resolved.messages, pluginOrder)
}

export function countPluginAssembleAdditionTokens(
  resolved: PluginAssembleAdditionResolved,
  tokenModel?: string,
): number {
  const messages =
    resolved.kind === 'legacy'
      ? resolved.messages
      : resolved.injections.map((i) => ({
          role: i.role,
          content: i.content,
        }))
  return countChatMessagesTokens(messages, { model: tokenModel })
}

function resolveInjectionSpanForApply(
  ctx: AfterAssemblePromptsContext,
): PluginPromptInjectionSpan {
  if (ctx.injectionSpan) return ctx.injectionSpan
  const messages = ctx.messages ?? []
  const history = ctx.trimmedHistoryMessages ?? []
  return resolvePluginInjectionSpan(messages, history)
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
  module: LoadedServerPlugin['module'],
  ctx: AfterAssemblePromptsContext,
  api: ReturnType<typeof createPluginServerHostApi>,
  cache?: PluginAssembleAdditionCache,
): Promise<PluginAssembleAdditionResolved | null> {
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
  const normalized = normalizeHookAddition(addition)
  cache?.set(pluginId, normalized)
  return normalized
}

/** 插件 afterAssemble 追加内容的 token 预留（不参与 budget trim 裁切） */
export async function estimatePluginsAfterAssembleTokenReserve(
  ctx: AfterAssemblePromptsContext,
): Promise<number> {
  const cache = ctx.additionCache ?? new Map<string, PluginAssembleAdditionResolved | null>()
  if (!ctx.additionCache) ctx.additionCache = cache

  const { plugins, api } = await ensureAssembleRuntime(ctx)
  let total = 0
  for (const p of plugins) {
    const addition = await resolvePluginAddition(p.id, p.module, ctx, api, cache)
    if (addition) {
      total += countPluginAssembleAdditionTokens(addition, ctx.tokenModel)
    }
  }
  return total
}

export async function applyPluginsAfterAssemblePrompts(
  ctx: AfterAssemblePromptsContext,
): Promise<ChatMessage[]> {
  const cache = ctx.additionCache ?? new Map<string, PluginAssembleAdditionResolved | null>()
  if (!ctx.additionCache) ctx.additionCache = cache

  const { plugins, api } = await ensureAssembleRuntime(ctx)
  let messages = ctx.messages ?? []
  let span = resolveInjectionSpanForApply(ctx)

  for (const p of plugins) {
    const addition = await resolvePluginAddition(p.id, p.module, ctx, api, cache)
    if (addition) {
      const injections = additionToInjections(addition, p.order)
      const merged = mergePluginPromptInjectionsIntoMessages(
        messages,
        injections,
        span,
      )
      messages = merged.messages
      span = merged.span
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
