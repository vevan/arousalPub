import type { ChatMessage } from './assemble-prompts.js'
import type { PromptMacroContext } from './prompt-macros/types.js'
import type { ChatPluginsBody, TurnPluginEntry } from './plugin-types.js'
import { mergeTurnPluginEntry } from './turn-plugin-utils.js'
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
  resolvePluginInjectionOrder,
  type PluginPromptInjection,
} from './shared/plugin-prompt-injection.js'
import {
  POST_USER_INJECTION_ORDER_HOST_DEFAULTS,
  type AssembleInjectionOrderSlots,
  type PostUserInjectionOrderHostPolicy,
} from './shared/post-user-injection-order.js'
import { resolveEffectiveAssembleInjectionOrderSlots } from './plugin-system/resolve-effective-assemble-injection-slots.js'

export { mergePluginPromptInjectionsIntoMessages } from './plugin-prompt-injection-merge.js'
export type { PluginPromptInjectionSpan } from './plugin-prompt-injection-merge.js'
export { resolvePluginInjectionSpan } from './plugin-prompt-injection-merge.js'

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
  /** 群聊 assemble 已插入的 afterUserInput（与插件注入同一 injectionOrder 空间） */
  afterUserInput?: {
    content: string
    role?: 'system' | 'user' | 'assistant'
    implicitInjectionOrder?: number
    excludeContents?: string[]
  }
  /** 宿主隐式 injectionOrder 档位（用户偏好覆盖） */
  hostInjectionOrderPolicy?: PostUserInjectionOrderHostPolicy
  /** 单次 assemble 内缓存 manifest+settings 合并后的 injectionOrder slots */
  injectionOrderSlotsCache?: Map<string, AssembleInjectionOrderSlots>
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
  defaultOrder: number,
): PluginPromptInjection[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    position: {
      kind: 'chat' as const,
      depth: 0,
      injectionOrder: defaultOrder,
    },
  }))
}

export function additionToInjections(
  resolved: PluginAssembleAdditionResolved,
  hostPolicy: PostUserInjectionOrderHostPolicy = POST_USER_INJECTION_ORDER_HOST_DEFAULTS,
): PluginPromptInjection[] {
  if (resolved.kind === 'legacy') {
    return legacyMessagesToInjections(resolved.messages, hostPolicy.default)
  }
  return resolved.injections.map((inj) => ({
    ...inj,
    position: {
      ...inj.position,
      injectionOrder: resolvePluginInjectionOrder(
        inj.position,
        hostPolicy.default,
      ),
    },
  }))
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

async function resolveEffectiveSlotsCached(
  pluginId: string,
  ctx: AfterAssemblePromptsContext,
): Promise<Awaited<ReturnType<typeof resolveEffectiveAssembleInjectionOrderSlots>>> {
  if (!ctx.injectionOrderSlotsCache) {
    ctx.injectionOrderSlotsCache = new Map()
  }
  const cached = ctx.injectionOrderSlotsCache.get(pluginId)
  if (cached) return cached
  const slots = await resolveEffectiveAssembleInjectionOrderSlots(pluginId)
  ctx.injectionOrderSlotsCache.set(pluginId, slots)
  return slots
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
      injectionOrderSlots: await resolveEffectiveSlotsCached(pluginId, ctx),
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
  const span = resolveInjectionSpanForApply(ctx)
  const collected: PluginPromptInjection[] = []
  const escapeHatchPlugins: LoadedServerPlugin[] = []

  const hostPolicy =
    ctx.hostInjectionOrderPolicy ?? POST_USER_INJECTION_ORDER_HOST_DEFAULTS

  for (const p of plugins) {
    const addition = await resolvePluginAddition(p.id, p.module, ctx, api, cache)
    if (addition) {
      collected.push(...additionToInjections(addition, hostPolicy))
      continue
    }
    if (typeof p.module.afterAssemblePrompts === 'function') {
      escapeHatchPlugins.push(p)
    }
  }

  let messages = ctx.messages ?? []
  if (collected.length > 0) {
    const mergeOpts: Parameters<typeof mergePluginPromptInjectionsIntoMessages>[3] = {
      hostInjectionOrderPolicy: hostPolicy,
    }
    if (ctx.afterUserInput?.content?.trim()) {
      mergeOpts.afterUserInput = {
        content: ctx.afterUserInput.content,
        role: ctx.afterUserInput.role,
        implicitInjectionOrder:
          ctx.afterUserInput.implicitInjectionOrder ?? hostPolicy.afterUserInput,
        excludeContents: ctx.afterUserInput.excludeContents,
      }
    }
    const merged = mergePluginPromptInjectionsIntoMessages(
      messages,
      collected,
      span,
      mergeOpts,
    )
    messages = merged.messages
  }

  for (const p of escapeHatchPlugins) {
    const next = await p.module.afterAssemblePrompts!(
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
    merged = mergeTurnPluginEntry(merged, entry) as TurnPluginEntry[]
  }
  return merged
}
