import type {
  PromptEntry,
  PromptPreset,
  PromptRole,
  PromptTrigger,
} from '@/stores/prompts'

export interface ChatMessage {
  role: PromptRole
  content: string
}

export interface AssembleContext {
  /** 当前触发场景；undefined = 预览模式，不按触发器过滤 */
  trigger?: PromptTrigger
  /** 绑定角色注入文本；undefined 时使用占位符 */
  character?: string
  /** 绑定世界/lorebook 注入文本 */
  world?: string
  /** 历史消息（已按时间正序：最旧 → 最新） */
  history?: ChatMessage[]
  /** 用户本轮输出（user input） */
  userInput?: string
  /** 总 token 上限；超过时从最旧的历史消息开始一条条删除 */
  maxTokens?: number
}

export interface AssembleResult {
  messages: ChatMessage[]
  /** 估算 token 总数 */
  estimatedTokens: number
  /** 因 token 超限被裁掉的历史消息条数 */
  droppedHistoryCount: number
}

const PLACEHOLDER = {
  character: '{{character_card}}',
  world: '{{lorebook}}',
  history: '{{chat_history}}',
  userInput: '{{user_input}}',
} as const

/** 粗略估算：英文约 4 字符 / 中文约 1.5 字符 = 1 token，统一用 / 3.5 近似 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 3.5))
}

function messagesTokens(msgs: ChatMessage[]): number {
  let total = 0
  for (const m of msgs) {
    total += estimateTokens(m.content) + 4
  }
  return total + 2
}

/** 触发器匹配：空 triggers = 任何时候都启用 */
function entryMatchesTrigger(
  entry: PromptEntry,
  trigger: PromptTrigger | undefined,
): boolean {
  if (!entry.enabled) return false
  if (entry.triggers.length === 0) return true
  if (trigger === undefined) return true
  return entry.triggers.includes(trigger)
}

/** 取分组内 enabled + trigger 匹配 + position='relative' 的条目，按 order 升序 */
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

/**
 * 组装提示词：
 * 1. 先按分组顺序，对每个 normal 分组取 position='relative' 的条目；
 *    占位分组（character/world/history/userInput）按 kind 注入对应内容（或占位符）
 * 2. 再把 position='chat' 的条目按 depth + order 插入 messages
 *    depth=0 → 最靠底部，depth=N → 倒数第 N+1 个位置之前
 * 3. 若 maxTokens 给出且超限：从 history 第一条开始一条条删，直到合法或无可删
 */
export function assemblePrompts(
  preset: PromptPreset,
  ctx: AssembleContext = {},
): AssembleResult {
  const trigger = ctx.trigger
  const groups = preset.groups.slice().sort((a, b) => a.order - b.order)
  const messages: ChatMessage[] = []
  /** 记录 history 段在 messages 中的 [start, end) 区间，用于 token 超限裁剪 */
  let historyStart = -1
  let historyEnd = -1

  for (const g of groups) {
    if (g.kind === 'normal') {
      const entries = relativeEntriesForGroup(preset, g.id, trigger)
      for (const e of entries) {
        messages.push({ role: e.role, content: e.content })
      }
    } else if (g.kind === 'character') {
      messages.push({
        role: 'system',
        content: ctx.character ?? PLACEHOLDER.character,
      })
    } else if (g.kind === 'world') {
      messages.push({
        role: 'system',
        content: ctx.world ?? PLACEHOLDER.world,
      })
    } else if (g.kind === 'history') {
      historyStart = messages.length
      if (ctx.history && ctx.history.length > 0) {
        for (const m of ctx.history) {
          messages.push({ role: m.role, content: m.content })
        }
      } else {
        messages.push({ role: 'system', content: PLACEHOLDER.history })
      }
      historyEnd = messages.length
    } else if (g.kind === 'userInput') {
      messages.push({
        role: 'user',
        content: ctx.userInput ?? PLACEHOLDER.userInput,
      })
    }
  }

  /** ===== position='chat' 注入 ===== */
  const chatEntries = preset.prompts
    .filter(
      (e) =>
        e.injectionPosition === 'chat' && entryMatchesTrigger(e, trigger),
    )
    .slice()

  // 按 depth 分桶（depth 大的先插入，从后向前不影响其它桶位置）
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
    /** chat 注入若落在 history 内/之前，会推后 history 区间 */
    if (historyStart >= 0) {
      if (insertAt <= historyStart) {
        historyStart += items.length
        historyEnd += items.length
      } else if (insertAt < historyEnd) {
        historyEnd += items.length
      }
    }
  }

  /** ===== token 超限：从最旧的历史消息开始删 ===== */
  let droppedHistoryCount = 0
  if (
    typeof ctx.maxTokens === 'number' &&
    ctx.maxTokens > 0 &&
    historyStart >= 0
  ) {
    while (
      messagesTokens(messages) > ctx.maxTokens &&
      historyEnd - historyStart > 0
    ) {
      messages.splice(historyStart, 1)
      historyEnd -= 1
      droppedHistoryCount += 1
    }
  }

  return {
    messages,
    estimatedTokens: messagesTokens(messages),
    droppedHistoryCount,
  }
}
