/** 提示词组装唯一实现（Web 通过 API 调用，不保留前端副本） */

import { applyPromptMacroPipeline } from './prompt-macros/index.js'
import type {
  MacroCharacterFields,
  PromptMacroContext,
} from './prompt-macros/index.js'
export type { PromptMacroContext } from './prompt-macros/index.js'
import type { AuthorsNoteRole } from './authors-note-settings.js'
import {
  ASSEMBLE_INJECT_PLACEHOLDER,
  loreTextToXmlBlock,
} from './prompt-xml.js'
import { countChatMessagesTokens } from './token-count.js'
import {
  isLegacyBindingSlot,
  isSystemBindingSlot,
} from './system-binding-slots.js'

export type GroupKind =
  | 'normal'
  | 'character'
  | 'world'
  | 'history'
  | 'userInput'
export type PromptRole = 'system' | 'user' | 'assistant'
export type InjectionPosition = 'relative' | 'chat'
export type PromptTrigger = 'normal' | 'continue' | 'swipe' | 'regenerate'

export type PromptBindingSlot =
  | 'boundMain'
  | 'boundWorldBefore'
  | 'boundWorldAfter'
  | 'boundUserPersona'
  | 'boundCharSystemPrompt'
  | 'boundCharDescription'
  | 'boundCharPersonality'
  | 'boundScenario'
  | 'boundEnhanceDefinitions'
  | 'boundDialogueExamples'
  | 'boundChatHistory'
  | 'boundCharacterPostHistory'
  | 'boundUserInput'
  | 'boundMemory'
  /** @deprecated 粗粒度 legacy；新预设请用系统子块 */
  | 'boundCharacterSystem'
  /** @deprecated 请用 boundWorldBefore */
  | 'boundWorld'
  /** @deprecated 请用 boundChatHistory */
  | 'boundRecentHistory'

export interface PromptGroup {
  id: string
  name: string
  kind: GroupKind
  order: number
  /** 备注，仅编辑页展示 */
  description?: string
  /** false = 组装时跳过组内无 bindingSlot 的自定义条目；绑定槽与 kind 内置注入仍保留 */
  enabled?: boolean
}

export interface PromptEntry {
  id: string
  groupId: string
  title: string
  content: string
  description: string
  tags: string[]
  enabled: boolean
  role: PromptRole
  injectionPosition: InjectionPosition
  injectionDepth: number
  injectionOrder: number
  triggers: PromptTrigger[]
  order: number
  isSeed?: boolean
  bindingSlot?: PromptBindingSlot
  characterBundlePosition?: 'before' | 'after'
  createdAt: string
  updatedAt: string
}

export interface PromptPreset {
  id: string
  name: string
  groups: PromptGroup[]
  prompts: PromptEntry[]
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  role: PromptRole
  content: string
  /** 对应 turn（history 条）；outgoing 改写正文后仍可用于宏索引 */
  turnId?: string
  turnOrdinal?: number
  receiveId?: string
  receiveIndex?: number
}

/** 会话绑定的一张角色卡切片；多卡时顺序即 {{char}}、{{char2}}… */
export interface BoundCharacterSlice {
  name?: string
  cardBody: string
  systemPrompt?: string
  postHistory?: string
  /** Phase A 宏字段（服务端加载卡时填充） */
  macroFields?: MacroCharacterFields
}

export interface AssembleContext {
  trigger?: PromptTrigger
  /** 会话绑定的用户 persona 卡（新建对话时选定；与 `characters` 中的 AI 卡分开） */
  userCharacter?: BoundCharacterSlice
  characters?: BoundCharacterSlice[]
  characterSystemPrompt?: string
  characterPostHistory?: string
  character?: string
  world?: string
  /** §14：已格式化的 `<memory>…</memory>` */
  memoryText?: string
  /** §14：近期 N 轮，按 turn 展开为 user/assistant 消息 */
  history?: ChatMessage[]
  userInput?: string
  maxTokens?: number
  /** OpenAI 风格模型名，用于 tiktoken 词表选择（默认 gpt-4o / o200k） */
  tokenModel?: string
  /** 若给出，在 token 裁剪前替换各条 message 中的 `{{user}}` / `{{char}}` 等 */
  macroContext?: PromptMacroContext
  /** 会话 Author's Note：在 chat-depth 条目之后、宏展开之前注入 */
  authorsNote?: {
    content: string
    injectionDepth: number
    role: AuthorsNoteRole
  } | null
  /** §14.4：为 true 时跳过 assemble 内 history 条级裁切（由 `runPromptBudgetTrimLoop` 统一处理） */
  skipInternalBudgetTrim?: boolean
  /** 为 true 时绑定槽一律输出 `<inject slot="…" />`，不注入示例/会话内容（提示词库组装预览） */
  bindingPlaceholderMode?: boolean
  /** 为 true 时跳过条级宏展开（由 assemble 调用方在 trim 后统一展宏） */
  deferMacroExpansion?: boolean
}

export interface AssembleResult {
  messages: ChatMessage[]
  estimatedTokens: number
  droppedHistoryCount: number
}

const PLACEHOLDER = {
  character: ASSEMBLE_INJECT_PLACEHOLDER.characterCard,
  userPersona: ASSEMBLE_INJECT_PLACEHOLDER.boundUserPersona,
  world: ASSEMBLE_INJECT_PLACEHOLDER.lorebook,
  history: ASSEMBLE_INJECT_PLACEHOLDER.chatHistory,
  userInput: ASSEMBLE_INJECT_PLACEHOLDER.userInput,
} as const

/** 宏展开后剔除 content.trim() 为空的 message（保留 side-effect 宏如 setvar 已执行） */
export function compactEmptyMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.content.trim().length > 0)
}

function compactEmptyMessagesAdjustHistory(
  messages: ChatMessage[],
  historyStart: number,
  historyEnd: number,
): { messages: ChatMessage[]; historyStart: number; historyEnd: number } {
  if (historyStart < 0) {
    return {
      messages: compactEmptyMessages(messages),
      historyStart: -1,
      historyEnd: -1,
    }
  }
  const out: ChatMessage[] = []
  let hs = -1
  let he = -1
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!m.content.trim()) continue
    const newIdx = out.length
    out.push(m)
    if (i >= historyStart && i < historyEnd) {
      if (hs < 0) hs = newIdx
      he = newIdx + 1
    }
  }
  return { messages: out, historyStart: hs, historyEnd: he }
}

function injectRecentHistoryMessages(
  messages: ChatMessage[],
  ctx: AssembleContext,
  insertAt?: number,
): boolean {
  const hist = ctx.history
  if (!hist?.length) return false
  const batch: ChatMessage[] = []
  for (const m of hist) {
    const c = m.content.trim()
    if (!c) continue
    batch.push({ ...m, role: m.role, content: m.content })
  }
  if (batch.length === 0) return false
  if (typeof insertAt === 'number') {
    messages.splice(insertAt, 0, ...batch)
  } else {
    for (const m of batch) messages.push(m)
  }
  return true
}

function mergedCharSystemPrompt(ctx: AssembleContext): string | undefined {
  if (ctx.characters && ctx.characters.length > 0) {
    const parts: string[] = []
    for (const c of ctx.characters) {
      const s = c.systemPrompt?.trim()
      if (s) parts.push(s)
    }
    if (parts.length > 0) return parts.join('\n\n')
  }
  const one = ctx.characterSystemPrompt?.trim()
  return one || undefined
}

function mergedUserPersonaBody(ctx: AssembleContext): string | undefined {
  const parts: string[] = []
  const userSp = ctx.userCharacter?.systemPrompt?.trim()
  if (userSp) parts.push(userSp)
  const userBody = ctx.userCharacter?.cardBody?.trim()
  if (userBody) parts.push(userBody)
  if (parts.length > 0) return parts.join('\n\n')
  return undefined
}

function mergedBoundPostHistory(ctx: AssembleContext): string | undefined {
  if (ctx.characters && ctx.characters.length > 0) {
    const parts: string[] = []
    for (const c of ctx.characters) {
      const s = c.postHistory?.trim()
      if (s) parts.push(s)
    }
    if (parts.length > 0) return parts.join('\n\n')
  }
  const one = ctx.characterPostHistory?.trim()
  return one || undefined
}

function looksLikePersonaXml(s: string): boolean {
  return /^\s*<(char|user)\b/i.test(s)
}

function mergedCharCardBody(ctx: AssembleContext): string | undefined {
  const blocks: string[] = []
  if (ctx.characters && ctx.characters.length > 0) {
    const bodies = ctx.characters
      .map((c) => c.cardBody?.trim())
      .filter((b): b is string => Boolean(b && b.length > 0))
    if (bodies.length > 0) {
      if (bodies.some((b) => looksLikePersonaXml(b))) {
        blocks.push(...bodies)
      } else {
        const parts: string[] = []
        for (const c of ctx.characters) {
          const body = c.cardBody?.trim()
          if (!body) continue
          const title = c.name?.trim()
          parts.push(title ? `## ${title}\n${body}` : body)
        }
        if (parts.length > 0) blocks.push(parts.join('\n\n---\n\n'))
      }
    }
  }
  if (blocks.length === 0) {
    const one = ctx.character?.trim()
    return one || undefined
  }
  return blocks.join('\n\n')
}

function mergedMacroFieldFromCharacters(
  ctx: AssembleContext,
  field: keyof MacroCharacterFields,
): string | undefined {
  const parts: string[] = []
  for (const c of ctx.characters ?? []) {
    const raw = c.macroFields?.[field]
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (v) parts.push(v)
  }
  if (parts.length > 0) return parts.join('\n\n')
  return undefined
}

/** 组装期去重：world before/after/legacy 共用一份 lore，只注入一次 */
interface AssembleInjectFlags {
  worldLoreConsumed: boolean
}

function createAssembleInjectFlags(): AssembleInjectFlags {
  return { worldLoreConsumed: false }
}

function worldInjectionText(ctx: AssembleContext): string {
  if (ctx.bindingPlaceholderMode) return PLACEHOLDER.world
  const w = ctx.world
  const usePlaceholder =
    w === undefined ||
    w === null ||
    w === PLACEHOLDER.world ||
    !String(w).trim()
  return usePlaceholder ? PLACEHOLDER.world : loreTextToXmlBlock(String(w))
}

function tryConsumeWorldLoreSlot(
  ctx: AssembleContext,
  flags: AssembleInjectFlags,
): string | undefined {
  if (flags.worldLoreConsumed) return undefined
  flags.worldLoreConsumed = true
  return worldInjectionText(ctx)
}

function hasEnabledChatHistoryBinding(entries: PromptEntry[]): boolean {
  return entries.some(
    (x) =>
      (x.bindingSlot === 'boundChatHistory' ||
        x.bindingSlot === 'boundRecentHistory') &&
      x.enabled !== false,
  )
}

function resolveSystemBindingContent(
  e: PromptEntry,
  ctx: AssembleContext,
  flags: AssembleInjectFlags,
): string | undefined {
  if (ctx.bindingPlaceholderMode && e.bindingSlot) {
    switch (e.bindingSlot) {
      case 'boundMain':
      case 'boundEnhanceDefinitions':
        return e.content.trim() || undefined
      case 'boundCharSystemPrompt':
        return ASSEMBLE_INJECT_PLACEHOLDER.boundCharacterSystem
      case 'boundCharDescription':
        return ASSEMBLE_INJECT_PLACEHOLDER.boundCharDescription
      case 'boundCharPersonality':
        return ASSEMBLE_INJECT_PLACEHOLDER.boundCharPersonality
      case 'boundScenario':
        return ASSEMBLE_INJECT_PLACEHOLDER.boundScenario
      case 'boundDialogueExamples':
        return ASSEMBLE_INJECT_PLACEHOLDER.boundDialogueExamples
      case 'boundWorldBefore':
      case 'boundWorldAfter':
      case 'boundWorld':
        return tryConsumeWorldLoreSlot(ctx, flags)
      case 'boundUserPersona':
        return PLACEHOLDER.userPersona
      default:
        return undefined
    }
  }
  switch (e.bindingSlot) {
    case 'boundMain':
    case 'boundEnhanceDefinitions':
      return e.content.trim() || undefined
    case 'boundCharSystemPrompt':
      return mergedCharSystemPrompt(ctx)
    case 'boundCharDescription':
      return mergedMacroFieldFromCharacters(ctx, 'description')
    case 'boundCharPersonality':
      return mergedMacroFieldFromCharacters(ctx, 'personality')
    case 'boundScenario':
      return mergedMacroFieldFromCharacters(ctx, 'scenario')
    case 'boundDialogueExamples':
      return mergedMacroFieldFromCharacters(ctx, 'mesExample')
    case 'boundWorldBefore':
    case 'boundWorldAfter':
    case 'boundWorld':
      return tryConsumeWorldLoreSlot(ctx, flags)
    case 'boundUserPersona':
      return mergedUserPersonaBody(ctx) ?? PLACEHOLDER.userPersona
    default:
      return undefined
  }
}

function injectLegacyCharacterSystemBlock(
  messages: ChatMessage[],
  ctx: AssembleContext,
  enabled: boolean,
): void {
  if (ctx.bindingPlaceholderMode) {
    if (enabled) {
      messages.push({
        role: 'system',
        content: ASSEMBLE_INJECT_PLACEHOLDER.boundCharacterSystem,
      })
    }
    messages.push({
      role: 'system',
      content: PLACEHOLDER.character,
    })
    return
  }
  if (enabled) {
    const sys = mergedCharSystemPrompt(ctx)
    if (sys) messages.push({ role: 'system', content: sys })
  }
  messages.push({
    role: 'system',
    content: mergedCharCardBody(ctx) ?? PLACEHOLDER.character,
  })
}

function assembleGroupByBindingOrder(
  sorted: PromptEntry[],
  g: PromptGroup,
  ctx: AssembleContext,
  messages: ChatMessage[],
  span: { historyStart: number; historyEnd: number },
  flags: AssembleInjectFlags,
): { historyStart: number; historyEnd: number } {
  let { historyStart, historyEnd } = span
  let memoryInjected = false
  let historyInjectedInGroup = false
  const deferredPostHistory: string[] = []

  const flushDeferredPostHistory = (): void => {
    for (const post of deferredPostHistory) {
      messages.push({ role: 'system', content: post })
    }
    deferredPostHistory.length = 0
  }

  for (const e of sorted) {
    if (e.bindingSlot) {
      if (e.enabled === false) continue
      switch (e.bindingSlot) {
        case 'boundCharacterSystem':
          injectLegacyCharacterSystemBlock(messages, ctx, e.enabled)
          break
        case 'boundChatHistory':
        case 'boundRecentHistory': {
          if (historyInjectedInGroup) break
          const block = injectChatHistoryBlock(messages, ctx, {
            historyStart,
            historyEnd,
          })
          historyStart = block.historyStart
          historyEnd = block.historyEnd
          historyInjectedInGroup = block.injected
          flushDeferredPostHistory()
          break
        }
        case 'boundCharacterPostHistory': {
          if (
            g.kind === 'history' &&
            !historyInjectedInGroup &&
            !hasEnabledChatHistoryBinding(sorted)
          ) {
            const block = injectChatHistoryBlock(messages, ctx, {
              historyStart,
              historyEnd,
            })
            historyStart = block.historyStart
            historyEnd = block.historyEnd
            historyInjectedInGroup = block.injected
            flushDeferredPostHistory()
          }
          if (ctx.bindingPlaceholderMode) {
            messages.push({
              role: 'system',
              content: ASSEMBLE_INJECT_PLACEHOLDER.boundCharacterPostHistory,
            })
            break
          }
          const post = mergedBoundPostHistory(ctx)
          if (post) {
            if (g.kind === 'history' && historyInjectedInGroup) {
              messages.push({ role: 'system', content: post })
            } else if (g.kind === 'history') {
              deferredPostHistory.push(post)
            } else {
              messages.push({ role: 'system', content: post })
            }
          }
          break
        }
        case 'boundUserInput':
          messages.push({
            role: 'user',
            content: ctx.userInput ?? PLACEHOLDER.userInput,
          })
          break
        case 'boundMemory': {
          if (ctx.bindingPlaceholderMode) {
            messages.push({
              role: 'system',
              content: ASSEMBLE_INJECT_PLACEHOLDER.memory,
            })
            memoryInjected = true
            break
          }
          const mem = ctx.memoryText?.trim()
          if (mem) {
            messages.push({ role: 'system', content: mem })
            memoryInjected = true
          }
          break
        }
        default: {
          const content = resolveSystemBindingContent(e, ctx, flags)
          if (content) {
            messages.push({ role: 'system', content })
          }
        }
      }
    } else {
      messages.push({ role: e.role, content: e.content })
    }
  }

  if (
    g.kind === 'world' &&
    !memoryInjected &&
    !sorted.some((x) => x.bindingSlot === 'boundMemory') &&
    ctx.memoryText?.trim() &&
    !ctx.bindingPlaceholderMode
  ) {
    messages.push({ role: 'system', content: ctx.memoryText.trim() })
  }

  if (
    g.kind === 'history' &&
    !historyInjectedInGroup &&
    !hasEnabledChatHistoryBinding(sorted)
  ) {
    const block = injectChatHistoryBlock(messages, ctx, {
      historyStart,
      historyEnd,
    })
    historyStart = block.historyStart
    historyEnd = block.historyEnd
    historyInjectedInGroup = true
    flushDeferredPostHistory()
  }

  if (g.kind === 'history' && deferredPostHistory.length > 0) {
    flushDeferredPostHistory()
  }

  if (
    g.kind === 'userInput' &&
    !sorted.some((x) => x.bindingSlot === 'boundUserInput')
  ) {
    messages.push({
      role: 'user',
      content: ctx.userInput ?? PLACEHOLDER.userInput,
    })
  }

  return { historyStart, historyEnd }
}

function groupUsesBindingOrderAssembly(
  g: PromptGroup,
  sorted: PromptEntry[],
): boolean {
  if (g.kind === 'history') {
    return sorted.length > 0
  }
  if (
    g.kind === 'character' ||
    g.kind === 'world' ||
    g.kind === 'userInput'
  ) {
    return sorted.some(
      (e) =>
        isSystemBindingSlot(e.bindingSlot) ||
        isLegacyBindingSlot(e.bindingSlot),
    )
  }
  return false
}

function injectChatHistoryBlock(
  messages: ChatMessage[],
  ctx: AssembleContext,
  span: { historyStart: number; historyEnd: number },
): { historyStart: number; historyEnd: number; injected: boolean } {
  if (ctx.bindingPlaceholderMode) {
    messages.push({ role: 'system', content: PLACEHOLDER.history })
    return { historyStart: -1, historyEnd: -1, injected: true }
  }
  const histBlockStart = messages.length
  const ok = injectRecentHistoryMessages(messages, ctx)
  if (!ok) {
    messages.push({ role: 'system', content: PLACEHOLDER.history })
  }
  let { historyStart, historyEnd } = span
  if (messages.length > histBlockStart) {
    historyStart = histBlockStart
    historyEnd = messages.length
  }
  return { historyStart, historyEnd, injected: true }
}

export { estimateTokens, countChatMessagesTokens } from './token-count.js'

const ROLE_RANK: Record<PromptRole, number> = {
  assistant: 0,
  user: 1,
  system: 2,
}

/** DOC §6.6：同位置同深度内 injectionOrder → order → role；depth 方向由锚点区段决定 */
export function compareInjectionEntries(
  a: PromptEntry,
  b: PromptEntry,
  opts?: { depthDirection?: 'asc' | 'desc' },
): number {
  const dir = opts?.depthDirection ?? 'desc'
  if (dir === 'desc') {
    const d = b.injectionDepth - a.injectionDepth
    if (d !== 0) return d
  } else {
    const d = a.injectionDepth - b.injectionDepth
    if (d !== 0) return d
  }
  const io = a.injectionOrder - b.injectionOrder
  if (io !== 0) return io
  const ord = a.order - b.order
  if (ord !== 0) return ord
  return ROLE_RANK[a.role] - ROLE_RANK[b.role]
}

function sortRelativeSlice(
  entries: PromptEntry[],
  afterAnchor: boolean,
): PromptEntry[] {
  return entries
    .slice()
    .sort((a, b) =>
      compareInjectionEntries(a, b, {
        depthDirection: afterAnchor ? 'asc' : 'desc',
      }),
    )
}

function sortByListOrder(entries: PromptEntry[]): PromptEntry[] {
  return entries.slice().sort((a, b) => a.order - b.order)
}

/** binding 组：列表 order 为主，同 order 再按 injectionDepth 等 tie-break */
function sortBindingGroupEntries(entries: PromptEntry[]): PromptEntry[] {
  return entries.slice().sort((a, b) => {
    const ord = a.order - b.order
    if (ord !== 0) return ord
    return compareInjectionEntries(a, b, { depthDirection: 'desc' })
  })
}

function messagesTokens(msgs: ChatMessage[], tokenModel?: string): number {
  return countChatMessagesTokens(msgs, { model: tokenModel })
}

function entryMatchesTrigger(
  entry: PromptEntry,
  trigger: PromptTrigger | undefined,
): boolean {
  if (
    entry.bindingSlot === 'boundWorld' ||
    entry.bindingSlot === 'boundWorldBefore' ||
    entry.bindingSlot === 'boundWorldAfter' ||
    entry.bindingSlot === 'boundUserInput' ||
    entry.bindingSlot === 'boundUserPersona' ||
    entry.bindingSlot === 'boundMemory' ||
    entry.bindingSlot === 'boundChatHistory' ||
    entry.bindingSlot === 'boundMain'
  ) {
    return true
  }
  if (!entry.enabled) return false
  if (entry.triggers.length === 0) return true
  if (trigger === undefined) return true
  return entry.triggers.includes(trigger)
}

/** 组禁用时仅跳过用户自定义条目（无 bindingSlot）；绑定槽仍参与组装 */
function entryAllowedWhenGroupMuted(entry: PromptEntry): boolean {
  return entry.bindingSlot != null
}

function entryAllowedForGroup(
  entry: PromptEntry,
  group: PromptGroup | undefined,
): boolean {
  if (!group || group.enabled !== false) return true
  return entryAllowedWhenGroupMuted(entry)
}

/** 取分组内 relative 条目（未排序；列表 order 仅用于锚点定位） */
function relativeEntriesForGroup(
  preset: PromptPreset,
  group: PromptGroup,
  trigger: PromptTrigger | undefined,
): PromptEntry[] {
  return preset.prompts.filter(
    (e) =>
      e.groupId === group.id &&
      e.injectionPosition === 'relative' &&
      entryAllowedForGroup(e, group) &&
      entryMatchesTrigger(e, trigger),
  )
}

/**
 * ST 兼容 chat 深度：以最后一条 user 消息为锚。
 * depth 0 = 紧接该 user 之后；depth n = 自该 user 向上数第 n 条消息之前插入。
 */
export function resolveChatDepthInsertIndex(
  messages: ChatMessage[],
  depth: number,
  historyStart = -1,
): number {
  const d = Math.max(0, Math.floor(depth))
  const floor = historyStart >= 0 ? historyStart : 0

  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUserIdx = i
      break
    }
  }

  if (lastUserIdx < 0) {
    return Math.max(floor, messages.length - d)
  }

  const insertAt = lastUserIdx - d + 1
  return Math.max(floor, Math.min(messages.length, insertAt))
}

function injectAuthorsNoteAtDepth(
  messages: ChatMessage[],
  note: NonNullable<AssembleContext['authorsNote']>,
  historyStart: number,
  historyEnd: number,
): { historyStart: number; historyEnd: number } {
  const insertAt = resolveChatDepthInsertIndex(
    messages,
    note.injectionDepth,
    historyStart,
  )
  messages.splice(insertAt, 0, {
    role: note.role,
    content: note.content,
  })
  let hs = historyStart
  let he = historyEnd
  if (hs >= 0) {
    if (insertAt <= hs) {
      hs += 1
      he += 1
    } else if (insertAt < he) {
      he += 1
    }
  }
  return { historyStart: hs, historyEnd: he }
}

export function assemblePrompts(
  preset: PromptPreset,
  ctx: AssembleContext = {},
): AssembleResult {
  const trigger = ctx.trigger
  const groups = preset.groups.slice().sort((a, b) => a.order - b.order)
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const messages: ChatMessage[] = []
  const injectFlags = createAssembleInjectFlags()
  let historyStart = -1
  let historyEnd = -1

  for (const g of groups) {
    if (g.kind === 'normal') {
      const entries = sortRelativeSlice(
        relativeEntriesForGroup(preset, g, trigger),
        false,
      )
      for (const e of entries) {
        messages.push({ role: e.role, content: e.content })
      }
    } else if (g.kind === 'character') {
      const entries = relativeEntriesForGroup(preset, g, trigger)
      const sorted = sortBindingGroupEntries(entries)
      if (groupUsesBindingOrderAssembly(g, sorted)) {
        const span = assembleGroupByBindingOrder(
          sorted,
          g,
          ctx,
          messages,
          { historyStart, historyEnd },
          injectFlags,
        )
        historyStart = span.historyStart
        historyEnd = span.historyEnd
      } else {
        if (ctx.bindingPlaceholderMode) {
          messages.push({
            role: 'system',
            content: ASSEMBLE_INJECT_PLACEHOLDER.boundCharacterSystem,
          })
          messages.push({
            role: 'system',
            content: PLACEHOLDER.character,
          })
        } else {
          const sys = mergedCharSystemPrompt(ctx)
          if (sys) messages.push({ role: 'system', content: sys })
          messages.push({
            role: 'system',
            content: mergedCharCardBody(ctx) ?? PLACEHOLDER.character,
          })
        }
      }
    } else if (g.kind === 'world') {
      const entries = relativeEntriesForGroup(preset, g, trigger)
      const sorted = sortBindingGroupEntries(entries)
      if (groupUsesBindingOrderAssembly(g, sorted)) {
        const span = assembleGroupByBindingOrder(
          sorted,
          g,
          ctx,
          messages,
          { historyStart, historyEnd },
          injectFlags,
        )
        historyStart = span.historyStart
        historyEnd = span.historyEnd
      } else {
        if (ctx.bindingPlaceholderMode) {
          const lore = tryConsumeWorldLoreSlot(ctx, injectFlags)
          if (lore) {
            messages.push({ role: 'system', content: lore })
          }
          messages.push({
            role: 'system',
            content: ASSEMBLE_INJECT_PLACEHOLDER.memory,
          })
        } else {
          const lore = tryConsumeWorldLoreSlot(ctx, injectFlags)
          if (lore) {
            messages.push({ role: 'system', content: lore })
          }
          if (ctx.memoryText?.trim()) {
            messages.push({ role: 'system', content: ctx.memoryText.trim() })
          }
        }
      }
    } else if (g.kind === 'history') {
      const entries = relativeEntriesForGroup(preset, g, trigger)
      const sorted = sortBindingGroupEntries(entries)
      if (groupUsesBindingOrderAssembly(g, sorted)) {
        const span = assembleGroupByBindingOrder(
          sorted,
          g,
          ctx,
          messages,
          { historyStart, historyEnd },
          injectFlags,
        )
        historyStart = span.historyStart
        historyEnd = span.historyEnd
      } else {
        if (ctx.bindingPlaceholderMode) {
          messages.push({ role: 'system', content: PLACEHOLDER.history })
        } else {
          const histBlockStart = messages.length
          const historyInjected = injectRecentHistoryMessages(messages, ctx)
          if (!historyInjected) {
            messages.push({ role: 'system', content: PLACEHOLDER.history })
          }
          if (messages.length > histBlockStart) {
            historyStart = histBlockStart
            historyEnd = messages.length
          }
        }
      }
    } else if (g.kind === 'userInput') {
      const entries = relativeEntriesForGroup(preset, g, trigger)
      const sorted = sortBindingGroupEntries(entries)
      if (groupUsesBindingOrderAssembly(g, sorted)) {
        const span = assembleGroupByBindingOrder(
          sorted,
          g,
          ctx,
          messages,
          { historyStart, historyEnd },
          injectFlags,
        )
        historyStart = span.historyStart
        historyEnd = span.historyEnd
      } else {
        messages.push({
          role: 'user',
          content: ctx.userInput ?? PLACEHOLDER.userInput,
        })
      }
    }
  }

  const chatEntries = preset.prompts
    .filter((e) => {
      if (e.injectionPosition !== 'chat') return false
      if (!entryMatchesTrigger(e, trigger)) return false
      return entryAllowedForGroup(e, groupById.get(e.groupId))
    })
    .slice()

  const byDepth = new Map<number, PromptEntry[]>()
  for (const e of chatEntries) {
    const arr = byDepth.get(e.injectionDepth) ?? []
    arr.push(e)
    byDepth.set(e.injectionDepth, arr)
  }
  const sortedDepths = [...byDepth.keys()].sort((a, b) => b - a)
  for (const d of sortedDepths) {
    const items = (byDepth.get(d) ?? [])
      .slice()
      .sort((a, b) => compareInjectionEntries(a, b))
    const insertAt = resolveChatDepthInsertIndex(messages, d, historyStart)
    messages.splice(
      insertAt,
      0,
      ...items.map((e) => ({ role: e.role, content: e.content })),
    )
    if (historyStart >= 0) {
      if (insertAt <= historyStart) {
        historyStart += items.length
        historyEnd += items.length
      } else if (insertAt < historyEnd) {
        historyEnd += items.length
      }
    }
  }

  const an = ctx.authorsNote
  if (an?.content?.trim()) {
    const shifted = injectAuthorsNoteAtDepth(
      messages,
      {
        content: an.content.trim(),
        injectionDepth: an.injectionDepth,
        role: an.role,
      },
      historyStart,
      historyEnd,
    )
    historyStart = shifted.historyStart
    historyEnd = shifted.historyEnd
  }

  const macro = ctx.macroContext
  if (macro && !ctx.deferMacroExpansion) {
    for (const m of messages) {
      m.content = applyPromptMacroPipeline(m.content, macro)
    }
  }

  if (!ctx.deferMacroExpansion) {
    const compacted = compactEmptyMessagesAdjustHistory(
      messages,
      historyStart,
      historyEnd,
    )
    messages.length = 0
    messages.push(...compacted.messages)
    historyStart = compacted.historyStart
    historyEnd = compacted.historyEnd
  }

  let droppedHistoryCount = 0
  if (
    !ctx.skipInternalBudgetTrim &&
    typeof ctx.maxTokens === 'number' &&
    ctx.maxTokens > 0 &&
    historyStart >= 0
  ) {
    while (
      messagesTokens(messages, ctx.tokenModel) > ctx.maxTokens &&
      historyEnd - historyStart > 0
    ) {
      messages.splice(historyStart, 1)
      historyEnd -= 1
      droppedHistoryCount += 1
    }
  }

  return {
    messages,
    estimatedTokens: messagesTokens(messages, ctx.tokenModel),
    droppedHistoryCount,
  }
}
