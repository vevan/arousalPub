/** 提示词组装唯一实现（Web 通过 API 调用，不保留前端副本） */

import { applyPromptMacroPipeline } from './prompt-macros/index.js'
import type { PromptMacroContext } from './prompt-macros/index.js'

export type { PromptMacroContext } from './prompt-macros/index.js'
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
  | 'boundWorld'
  | 'boundCharacterPostHistory'
  | 'boundUserInput'

export interface PromptGroup {
  id: string
  name: string
  kind: GroupKind
  order: number
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
}

/** 会话绑定的一张角色卡切片；多卡时顺序即 {{char}}、{{char2}}… */
export interface BoundCharacterSlice {
  name?: string
  cardBody: string
  systemPrompt?: string
  postHistory?: string
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
  history?: ChatMessage[]
  userInput?: string
  maxTokens?: number
  /** OpenAI 风格模型名，用于 tiktoken 词表选择（默认 gpt-4o / o200k） */
  tokenModel?: string
  /** 若给出，在 token 裁剪前替换各条 message 中的 `{{user}}` / `{{char}}` 等 */
  macroContext?: PromptMacroContext
}

export interface AssembleResult {
  messages: ChatMessage[]
  estimatedTokens: number
  droppedHistoryCount: number
}

const PLACEHOLDER = {
  character: ASSEMBLE_INJECT_PLACEHOLDER.characterCard,
  world: ASSEMBLE_INJECT_PLACEHOLDER.lorebook,
  history: ASSEMBLE_INJECT_PLACEHOLDER.chatHistory,
  userInput: ASSEMBLE_INJECT_PLACEHOLDER.userInput,
} as const

function mergedBoundSystemPrompt(ctx: AssembleContext): string | undefined {
  const parts: string[] = []
  const userSp = ctx.userCharacter?.systemPrompt?.trim()
  if (userSp) parts.push(userSp)
  if (ctx.characters && ctx.characters.length > 0) {
    for (const c of ctx.characters) {
      const s = c.systemPrompt?.trim()
      if (s) parts.push(s)
    }
  }
  if (parts.length > 0) return parts.join('\n\n')
  const one = ctx.characterSystemPrompt?.trim()
  return one || undefined
}

function mergedBoundPostHistory(ctx: AssembleContext): string | undefined {
  if (ctx.characters && ctx.characters.length > 0) {
    const parts: string[] = []
    for (const c of ctx.characters) {
      const s = c.postHistory?.trim()
      if (s) parts.push(s)
    }
    return parts.length > 0 ? parts.join('\n\n') : undefined
  }
  const one = ctx.characterPostHistory?.trim()
  return one || undefined
}

function looksLikePersonaXml(s: string): boolean {
  return /^\s*<(char|user)\b/i.test(s)
}

function mergedCharacterCardBody(ctx: AssembleContext): string | undefined {
  const blocks: string[] = []
  const userBody = ctx.userCharacter?.cardBody?.trim()
  if (userBody) blocks.push(userBody)

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

function messagesTokens(msgs: ChatMessage[], tokenModel?: string): number {
  return countChatMessagesTokens(msgs, { model: tokenModel })
}

function entryMatchesTrigger(
  entry: PromptEntry,
  trigger: PromptTrigger | undefined,
): boolean {
  if (
    entry.bindingSlot === 'boundWorld' ||
    entry.bindingSlot === 'boundUserInput'
  ) {
    return true
  }
  if (!entry.enabled) return false
  if (entry.triggers.length === 0) return true
  if (trigger === undefined) return true
  return entry.triggers.includes(trigger)
}

/** 取分组内可注入 + trigger 匹配 + position='relative' 的条目，按 order 升序 */
function relativeEntriesForGroup(
  preset: PromptPreset,
  groupId: string,
  trigger: PromptTrigger | undefined,
): PromptEntry[] {
  return preset.prompts
    .filter(
      (e) =>
        e.groupId === groupId &&
        e.injectionPosition === 'relative' &&
        entryMatchesTrigger(e, trigger),
    )
    .slice()
    .sort((a, b) => a.order - b.order)
}

export function assemblePrompts(
  preset: PromptPreset,
  ctx: AssembleContext = {},
): AssembleResult {
  const trigger = ctx.trigger
  const groups = preset.groups.slice().sort((a, b) => a.order - b.order)
  const messages: ChatMessage[] = []
  let historyStart = -1
  let historyEnd = -1

  for (const g of groups) {
    if (g.kind === 'normal') {
      const entries = relativeEntriesForGroup(preset, g.id, trigger)
      for (const e of entries) {
        messages.push({ role: e.role, content: e.content })
      }
    } else if (g.kind === 'character') {
      const charExtras = relativeEntriesForGroup(preset, g.id, trigger)
      const sorted = charExtras.slice().sort((a, b) => a.order - b.order)
      const sysIdx = sorted.findIndex(
        (e) => e.bindingSlot === 'boundCharacterSystem',
      )
      const sysEntry = sysIdx >= 0 ? sorted[sysIdx] : undefined
      const beforeBundle =
        sysIdx < 0
          ? sorted.filter((e) => e.bindingSlot !== 'boundCharacterSystem')
          : sorted
              .slice(0, sysIdx)
              .filter((e) => e.bindingSlot !== 'boundCharacterSystem')
      const afterBundle =
        sysIdx < 0
          ? []
          : sorted
              .slice(sysIdx + 1)
              .filter((e) => e.bindingSlot !== 'boundCharacterSystem')
      for (const e of beforeBundle) {
        messages.push({ role: e.role, content: e.content })
      }
      if (sysEntry) {
        const sys = mergedBoundSystemPrompt(ctx)
        if (sys) {
          messages.push({ role: 'system', content: sys })
        }
      }
      messages.push({
        role: 'system',
        content: mergedCharacterCardBody(ctx) ?? PLACEHOLDER.character,
      })
      for (const e of afterBundle) {
        messages.push({ role: e.role, content: e.content })
      }
    } else if (g.kind === 'world') {
      const w = ctx.world
      const usePlaceholder =
        w === undefined || w === null || w === PLACEHOLDER.world || !String(w).trim()
      const entries = relativeEntriesForGroup(preset, g.id, trigger)
      const hasBinding = entries.some((e) => e.bindingSlot === 'boundWorld')
      if (!hasBinding) {
        messages.push({
          role: 'system',
          content: usePlaceholder
            ? PLACEHOLDER.world
            : loreTextToXmlBlock(String(w)),
        })
      }
      for (const e of entries) {
        if (e.bindingSlot === 'boundWorld') {
          messages.push({
            role: 'system',
            content: usePlaceholder
              ? PLACEHOLDER.world
              : loreTextToXmlBlock(String(w)),
          })
        } else {
          messages.push({ role: e.role, content: e.content })
        }
      }
    } else if (g.kind === 'history') {
      historyStart = messages.length
      if (ctx.history && ctx.history.length > 0) {
        for (const m of ctx.history) {
          messages.push({ role: m.role, content: m.content })
        }
      } else {
        messages.push({ role: 'system', content: PLACEHOLDER.history })
      }
      const postHistory = relativeEntriesForGroup(preset, g.id, trigger)
      for (const e of postHistory) {
        if (e.bindingSlot === 'boundCharacterPostHistory') {
          const post = mergedBoundPostHistory(ctx)
          if (post) {
            messages.push({ role: 'system', content: post })
          }
        } else {
          messages.push({ role: e.role, content: e.content })
        }
      }
      historyEnd = messages.length
    } else if (g.kind === 'userInput') {
      const entries = relativeEntriesForGroup(preset, g.id, trigger)
      const hasBinding = entries.some((e) => e.bindingSlot === 'boundUserInput')
      if (!hasBinding) {
        messages.push({
          role: 'user',
          content: ctx.userInput ?? PLACEHOLDER.userInput,
        })
      }
      for (const e of entries) {
        if (e.bindingSlot === 'boundUserInput') {
          messages.push({
            role: 'user',
            content: ctx.userInput ?? PLACEHOLDER.userInput,
          })
        } else {
          messages.push({ role: e.role, content: e.content })
        }
      }
    }
  }

  const chatEntries = preset.prompts
    .filter(
      (e) =>
        e.injectionPosition === 'chat' && entryMatchesTrigger(e, trigger),
    )
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
      .sort((a, b) => a.injectionOrder - b.injectionOrder)
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

  const macro = ctx.macroContext
  if (macro) {
    for (const m of messages) {
      m.content = applyPromptMacroPipeline(m.content, macro)
    }
  }

  let droppedHistoryCount = 0
  if (
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
