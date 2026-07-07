import {
  compareInjectionEntries,
  resolveChatDepthInsertIndex,
  type ChatMessage,
  type PromptEntry,
  type PromptRole,
} from './assemble-prompts.js'
import type { PluginPromptInjection } from './shared/plugin-prompt-injection.js'

export type PluginPromptInjectionSpan = {
  historyStart: number
  historyEnd: number
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
    injectionOrder: inj.position.injectionOrder ?? 0,
    order: inj.position.order ?? 0,
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
): { messages: ChatMessage[]; span: PluginPromptInjectionSpan } {
  if (injections.length === 0) {
    return { messages: [...messages], span: { ...span } }
  }

  let out = [...messages]
  let { historyStart, historyEnd } = span

  const byDepth = new Map<number, PluginPromptInjection[]>()
  for (const inj of injections) {
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
