import {
  compareInjectionEntries,
  resolveChatDepthInsertIndex,
  type ChatMessage,
  type PromptEntry,
  type PromptRole,
} from './assemble-prompts.js'
import { findHistorySpanInMessages } from './regex-outgoing.js'
import {
  CHAT_INJECTION_ORDER_DEFAULT,
  resolvePluginInjectionOrder,
  type PluginPromptInjection,
} from './shared/plugin-prompt-injection.js'

export type PluginPromptInjectionSpan = {
  historyStart: number
  historyEnd: number
}

/** DOC/38 §3.4 · 群聊 afterUserInput 在 post-user 排序空间内的隐式 injectionOrder（暂硬编码） */
export const AFTER_USER_INPUT_IMPLICIT_INJECTION_ORDER = 20

/** assemble 已插入的 preset chat depth 0 等 post-user 条目默认 injectionOrder（一期无 messages 元数据） */
export const PRESET_CHAT_DEPTH0_IMPLICIT_INJECTION_ORDER = CHAT_INJECTION_ORDER_DEFAULT

/** @deprecated 使用 AFTER_USER_INPUT_IMPLICIT_INJECTION_ORDER */
export const AFTER_USER_INPUT_IMPLICIT_ORDER = AFTER_USER_INPUT_IMPLICIT_INJECTION_ORDER

export type PluginPromptMergeAfterUserInput = {
  content: string
  role?: PluginPromptInjection['role']
  implicitInjectionOrder?: number
  /** 展宏后需排除的 post-user 条目（如 depth 0 authorsNote），避免误标为 afterUserInput */
  excludeContents?: string[]
  /** @deprecated 使用 implicitInjectionOrder */
  implicitOrder?: number
}

export type PluginPromptInjectionMergeOptions = {
  /** assemble 阶段已插入的群聊说明；与插件描述符同一 injectionOrder 空间归并 */
  afterUserInput?: PluginPromptMergeAfterUserInput
}

function findLastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') return i
  }
  return -1
}

function buildAfterUserInputExcludeSet(
  hint: PluginPromptMergeAfterUserInput | undefined,
): Set<string> {
  return new Set(
    (hint?.excludeContents ?? [])
      .map((c) => c.trim())
      .filter((c) => c.length > 0),
  )
}

/** 在 post-user tail 中定位 afterUserInput 条目（供 hoist 与单测）。 */
export function resolveAfterUserInputTailIndex(
  tail: ChatMessage[],
  hint: PluginPromptMergeAfterUserInput | undefined,
): number {
  const hintContent = hint?.content?.trim()
  const hintRole = hint?.role
  const exclude = buildAfterUserInputExcludeSet(hint)

  if (hintContent) {
    const exact = tail.findIndex(
      (m) =>
        m.content.trim() === hintContent &&
        (!hintRole || m.role === hintRole),
    )
    if (exact >= 0) return exact
    return -1
  }

  if (hintRole !== 'system') return -1

  return tail.findIndex(
    (m) => m.role === 'system' && !exclude.has(m.content.trim()),
  )
}

/**
 * regex 后从 messages 解析群聊 afterUserInput。
 * 须传入 post-regex 群聊正文（`groupChatContent`）；无法解析时不返回 hint。
 */
export function buildPluginAfterUserInputHintFromMessages(
  messages: ChatMessage[],
  opts: {
    groupChatContent: string
    authorsNoteExcludeContent?: string
  },
): PluginPromptMergeAfterUserInput | undefined {
  const groupContent = opts.groupChatContent.trim()
  if (!groupContent) return undefined

  const lastUserIdx = findLastUserIndex(messages)
  if (lastUserIdx < 0) return undefined
  const tail = messages.slice(lastUserIdx + 1)

  const excludeContents: string[] = []
  const authorsNoteExclude = opts.authorsNoteExcludeContent?.trim()
  if (authorsNoteExclude) {
    excludeContents.push(authorsNoteExclude)
  }

  const idx = resolveAfterUserInputTailIndex(tail, {
    content: groupContent,
    role: 'system',
    excludeContents,
  })
  if (idx < 0) return undefined

  return {
    content: tail[idx]!.content,
    role: 'system',
    ...(excludeContents.length > 0 ? { excludeContents } : {}),
  }
}

function hoistPostUserTailIntoInjections(
  messages: ChatMessage[],
  opts: PluginPromptInjectionMergeOptions | undefined,
  injections: PluginPromptInjection[],
): { messages: ChatMessage[]; injections: PluginPromptInjection[] } {
  const lastUserIdx = findLastUserIndex(messages)
  if (lastUserIdx < 0) return { messages, injections }

  const head = messages.slice(0, lastUserIdx + 1)
  const tail = messages.slice(lastUserIdx + 1)
  if (tail.length === 0) return { messages, injections }

  const hint = opts?.afterUserInput
  const afterUserInputIndex = resolveAfterUserInputTailIndex(tail, hint)

  const tailInjections: PluginPromptInjection[] = []
  for (let i = 0; i < tail.length; i++) {
    const m = tail[i]!
    const isAfterUserInput = i === afterUserInputIndex

    if (isAfterUserInput) {
      const injectionOrder =
        hint?.implicitInjectionOrder ??
        hint?.implicitOrder ??
        AFTER_USER_INPUT_IMPLICIT_INJECTION_ORDER
      tailInjections.push({
        role: m.role as PluginPromptInjection['role'],
        content: m.content,
        position: {
          kind: 'chat',
          depth: 0,
          injectionOrder,
        },
      })
      continue
    }

    tailInjections.push({
      role: m.role as PluginPromptInjection['role'],
      content: m.content,
      position: {
        kind: 'chat',
        depth: 0,
        injectionOrder: PRESET_CHAT_DEPTH0_IMPLICIT_INJECTION_ORDER,
      },
    })
  }

  return {
    messages: head,
    injections: [...injections, ...tailInjections],
  }
}

/** 从 regex 后 messages 与 trim 后 history 段定位 historySpan（供插件注入 depth 锚点）。 */
export function resolvePluginInjectionSpan(
  messages: ChatMessage[],
  trimmedHistoryMessages: ChatMessage[],
): PluginPromptInjectionSpan {
  if (trimmedHistoryMessages.length === 0) {
    return { historyStart: -1, historyEnd: -1 }
  }
  const hit = findHistorySpanInMessages(messages, trimmedHistoryMessages)
  if (!hit) {
    return { historyStart: -1, historyEnd: -1 }
  }
  return {
    historyStart: hit.start,
    historyEnd: hit.start + hit.length,
  }
}

function shiftHistorySpanAfterInsert(
  historyStart: number,
  historyEnd: number,
  insertAt: number,
  count: number,
): PluginPromptInjectionSpan {
  if (historyStart < 0) {
    return { historyStart, historyEnd }
  }
  if (insertAt <= historyStart) {
    return {
      historyStart: historyStart + count,
      historyEnd: historyEnd + count,
    }
  }
  if (insertAt < historyEnd) {
    return { historyStart, historyEnd: historyEnd + count }
  }
  return { historyStart, historyEnd }
}

function injectionToPromptEntry(inj: PluginPromptInjection): PromptEntry {
  const depth = Math.max(0, Math.floor(inj.position.depth))
  return {
    id: '',
    groupId: '',
    title: '',
    content: inj.content,
    description: '',
    tags: [],
    enabled: true,
    role: inj.role as PromptRole,
    injectionPosition: 'chat',
    injectionDepth: depth,
    injectionOrder: resolvePluginInjectionOrder(inj.position),
    order: 0,
    triggers: [],
    createdAt: '',
    updatedAt: '',
  }
}

function compareInjections(a: PluginPromptInjection, b: PluginPromptInjection): number {
  return compareInjectionEntries(
    injectionToPromptEntry(a),
    injectionToPromptEntry(b),
  )
}

/**
 * 将插件注入描述符按 §6.6 chat depth 归并进 messages（post-user 区）。
 * 与 `assemble-prompts` preset chat 深度插入语义一致。
 */
export function mergePluginPromptInjectionsIntoMessages(
  messages: ChatMessage[],
  injections: PluginPromptInjection[],
  span: PluginPromptInjectionSpan = { historyStart: -1, historyEnd: -1 },
  opts?: PluginPromptInjectionMergeOptions,
): { messages: ChatMessage[]; span: PluginPromptInjectionSpan } {
  const hoisted = hoistPostUserTailIntoInjections(messages, opts, injections)
  let out = hoisted.messages
  const collected = hoisted.injections

  if (collected.length === 0) {
    return { messages: [...out], span: { ...span } }
  }

  let { historyStart, historyEnd } = span

  const byDepth = new Map<number, PluginPromptInjection[]>()
  for (const inj of collected) {
    const depth = Math.max(0, Math.floor(inj.position.depth))
    const list = byDepth.get(depth) ?? []
    list.push(inj)
    byDepth.set(depth, list)
  }

  const sortedDepths = [...byDepth.keys()].sort((a, b) => b - a)
  for (const depth of sortedDepths) {
    const items = (byDepth.get(depth) ?? []).slice().sort(compareInjections)
    const insertAt = resolveChatDepthInsertIndex(out, depth, historyStart)
    const chunk: ChatMessage[] = items.map((inj) => ({
      role: inj.role,
      content: inj.content,
    }))
    out.splice(insertAt, 0, ...chunk)
    const shifted = shiftHistorySpanAfterInsert(
      historyStart,
      historyEnd,
      insertAt,
      chunk.length,
    )
    historyStart = shifted.historyStart
    historyEnd = shifted.historyEnd
  }

  return {
    messages: out,
    span: { historyStart, historyEnd },
  }
}
