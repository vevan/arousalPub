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
  | 'boundCharacterSystem'
  | 'boundUserPersona'
  | 'boundWorld'
  | 'boundMemory'
  | 'boundCharacterPostHistory'
  | 'boundRecentHistory'
  | 'boundUserInput'

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

function messagesTokens(msgs: ChatMessage[], tokenModel?: string): number {
  return countChatMessagesTokens(msgs, { model: tokenModel })
}

function entryMatchesTrigger(
  entry: PromptEntry,
  trigger: PromptTrigger | undefined,
): boolean {
  if (
    entry.bindingSlot === 'boundWorld' ||
    entry.bindingSlot === 'boundUserInput' ||
    entry.bindingSlot === 'boundUserPersona' ||
    entry.bindingSlot === 'boundMemory'
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

function presetHasBinding(
  preset: PromptPreset,
  slot: PromptBindingSlot,
): boolean {
  return preset.prompts.some((e) => e.bindingSlot === slot)
}

function injectAuthorsNoteAtDepth(
  messages: ChatMessage[],
  note: NonNullable<AssembleContext['authorsNote']>,
  historyStart: number,
  historyEnd: number,
): { historyStart: number; historyEnd: number } {
  const depth = Math.max(0, Math.floor(note.injectionDepth))
  const insertAt = Math.max(0, messages.length - depth)
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
      const charExtras = relativeEntriesForGroup(preset, g, trigger)
      const sorted = sortByListOrder(charExtras)
      const charIdx = sorted.findIndex(
        (e) => e.bindingSlot === 'boundCharacterSystem',
      )
      const userIdx = sorted.findIndex(
        (e) => e.bindingSlot === 'boundUserPersona',
      )
      const charEntry = charIdx >= 0 ? sorted[charIdx] : undefined
      const userEntry = userIdx >= 0 ? sorted[userIdx] : undefined
      const isCharacterBinding = (e: PromptEntry) =>
        e.bindingSlot === 'boundCharacterSystem' ||
        e.bindingSlot === 'boundUserPersona'
      const effectiveCharIdx = charIdx >= 0 ? charIdx : sorted.length
      const effectiveUserIdx =
        userIdx >= 0 ? userIdx : sorted.length
      const beforeChar = sorted
        .slice(0, effectiveCharIdx)
        .filter((e) => !isCharacterBinding(e))
      const between =
        effectiveUserIdx > effectiveCharIdx
          ? sorted
              .slice(effectiveCharIdx + 1, effectiveUserIdx)
              .filter((e) => !isCharacterBinding(e))
          : []
      const afterUser =
        effectiveUserIdx < sorted.length
          ? sorted
              .slice(effectiveUserIdx + 1)
              .filter((e) => !isCharacterBinding(e))
          : sorted.filter((e) => !isCharacterBinding(e))

      for (const e of sortRelativeSlice(beforeChar, false)) {
        messages.push({ role: e.role, content: e.content })
      }
      if (charEntry) {
        if (charEntry.enabled !== false) {
          const sys = mergedCharSystemPrompt(ctx)
          if (sys) {
            messages.push({ role: 'system', content: sys })
          }
        }
        messages.push({
          role: 'system',
          content: mergedCharCardBody(ctx) ?? PLACEHOLDER.character,
        })
      } else if (!userEntry) {
        messages.push({
          role: 'system',
          content: mergedCharCardBody(ctx) ?? PLACEHOLDER.character,
        })
      }
      for (const e of sortRelativeSlice(between, true)) {
        messages.push({ role: e.role, content: e.content })
      }
      if (userEntry) {
        messages.push({
          role: 'system',
          content: mergedUserPersonaBody(ctx) ?? PLACEHOLDER.userPersona,
        })
      }
      for (const e of sortRelativeSlice(afterUser, true)) {
        messages.push({ role: e.role, content: e.content })
      }
    } else if (g.kind === 'world') {
      const w = ctx.world
      const usePlaceholder =
        w === undefined || w === null || w === PLACEHOLDER.world || !String(w).trim()
      const entries = relativeEntriesForGroup(preset, g, trigger)
      const sorted = sortByListOrder(entries)
      const worldIdx = sorted.findIndex((e) => e.bindingSlot === 'boundWorld')
      const hasBinding = worldIdx >= 0
      const beforeBundle =
        worldIdx < 0
          ? sorted.filter((e) => e.bindingSlot !== 'boundWorld')
          : sorted
              .slice(0, worldIdx)
              .filter((e) => e.bindingSlot !== 'boundWorld')
      const afterBundle =
        worldIdx < 0
          ? []
          : sorted
              .slice(worldIdx + 1)
              .filter((e) => e.bindingSlot !== 'boundWorld')
      if (!hasBinding) {
        messages.push({
          role: 'system',
          content: usePlaceholder
            ? PLACEHOLDER.world
            : loreTextToXmlBlock(String(w)),
        })
      }
      for (const e of sortRelativeSlice(beforeBundle, false)) {
        messages.push({ role: e.role, content: e.content })
      }
      if (hasBinding) {
        messages.push({
          role: 'system',
          content: usePlaceholder
            ? PLACEHOLDER.world
            : loreTextToXmlBlock(String(w)),
        })
      }
      let memoryInjected = false
      for (const e of sortRelativeSlice(afterBundle, true)) {
        if (e.bindingSlot === 'boundMemory') {
          const mem = ctx.memoryText?.trim()
          if (mem) {
            messages.push({ role: 'system', content: mem })
            memoryInjected = true
          }
        } else {
          messages.push({ role: e.role, content: e.content })
        }
      }
      if (
        !memoryInjected &&
        !presetHasBinding(preset, 'boundMemory') &&
        ctx.memoryText?.trim()
      ) {
        messages.push({ role: 'system', content: ctx.memoryText.trim() })
      }
    } else if (g.kind === 'history') {
      const entries = relativeEntriesForGroup(preset, g, trigger)
      const sorted = sortByListOrder(entries)
      const postIdx = sorted.findIndex(
        (e) => e.bindingSlot === 'boundCharacterPostHistory',
      )
      const postEntry = postIdx >= 0 ? sorted[postIdx] : undefined
      const isHistoryBindingMarker = (e: PromptEntry) =>
        e.bindingSlot === 'boundRecentHistory' ||
        e.bindingSlot === 'boundCharacterPostHistory'
      const beforeBundle =
        postIdx < 0
          ? sorted.filter((e) => !isHistoryBindingMarker(e))
          : sorted
              .slice(0, postIdx)
              .filter((e) => !isHistoryBindingMarker(e))
      const afterBundle =
        postIdx < 0
          ? []
          : sorted
              .slice(postIdx + 1)
              .filter((e) => !isHistoryBindingMarker(e))

      for (const e of sortRelativeSlice(beforeBundle, false)) {
        messages.push({ role: e.role, content: e.content })
      }

      const histBlockStart = messages.length
      const historyInjected = injectRecentHistoryMessages(messages, ctx)
      if (!historyInjected) {
        messages.push({ role: 'system', content: PLACEHOLDER.history })
      }
      if (messages.length > histBlockStart) {
        historyStart = histBlockStart
        historyEnd = messages.length
      }

      if (postEntry) {
        const post = mergedBoundPostHistory(ctx)
        if (post) {
          messages.push({ role: 'system', content: post })
        }
      }

      for (const e of sortRelativeSlice(afterBundle, true)) {
        messages.push({ role: e.role, content: e.content })
      }
    } else if (g.kind === 'userInput') {
      const entries = relativeEntriesForGroup(preset, g, trigger)
      const sorted = sortByListOrder(entries)
      const inputIdx = sorted.findIndex((e) => e.bindingSlot === 'boundUserInput')
      const hasBinding = inputIdx >= 0
      const beforeBundle =
        inputIdx < 0
          ? sorted.filter((e) => e.bindingSlot !== 'boundUserInput')
          : sorted
              .slice(0, inputIdx)
              .filter((e) => e.bindingSlot !== 'boundUserInput')
      const afterBundle =
        inputIdx < 0
          ? []
          : sorted
              .slice(inputIdx + 1)
              .filter((e) => e.bindingSlot !== 'boundUserInput')
      if (!hasBinding) {
        messages.push({
          role: 'user',
          content: ctx.userInput ?? PLACEHOLDER.userInput,
        })
      }
      for (const e of sortRelativeSlice(beforeBundle, false)) {
        messages.push({ role: e.role, content: e.content })
      }
      if (hasBinding) {
        messages.push({
          role: 'user',
          content: ctx.userInput ?? PLACEHOLDER.userInput,
        })
      }
      for (const e of sortRelativeSlice(afterBundle, true)) {
        messages.push({ role: e.role, content: e.content })
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
    const insertAt = Math.max(0, messages.length - d)
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
