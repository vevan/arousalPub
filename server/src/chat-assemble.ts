import {
  assemblePrompts,
  type BoundCharacterSlice,
  type ChatMessage,
  type PromptPreset,
  type PromptTrigger,
} from './assemble-prompts.js'
import { buildPromptMacroContext } from './prompt-macros.js'
import { cardRecordToCharXmlBlock } from './prompt-xml.js'
import {
  getTurnUserText,
  readConversationIndex,
  readTailChunk,
  resolvedCharacterIds,
  type ChunkFile,
  type ConversationIndex,
  type TurnRecord,
} from './chat-storage.js'
import { readCharacterDocument } from './character-storage.js'
import type { PromptsDocument } from './prompts-file.js'

function asPromptPreset(raw: unknown): PromptPreset | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<PromptPreset>
  if (typeof p.id !== 'string' || !p.id.trim()) return null
  if (!Array.isArray(p.groups) || !Array.isArray(p.prompts)) return null
  return p as PromptPreset
}

function pickPresetForConversation(
  idx: ConversationIndex,
  doc: PromptsDocument,
): PromptPreset | null {
  const presetsRaw = doc.presets
  const presets: PromptPreset[] = []
  for (const raw of presetsRaw) {
    const p = asPromptPreset(raw)
    if (p) presets.push(p)
  }
  if (presets.length === 0) return null
  const convId =
    typeof idx.promptPresetId === 'string' ? idx.promptPresetId.trim() : ''
  if (convId) {
    const hit = presets.find((x) => x.id === convId)
    if (hit) return hit
  }
  const activeId =
    typeof doc.activePresetId === 'string' ? doc.activePresetId.trim() : ''
  if (!activeId) return presets[0] ?? null
  return presets.find((x) => x.id === activeId) ?? presets[0] ?? null
}

/**
 * 角色卡 → BoundCharacterSlice：
 * - `cardBody` 为 XML 块（字段已转义，尚未跑宏，交由 assemble-prompts 最后宏展开）
 * - `systemPrompt` / `postHistory` 仍为纯文本，由 assemble-prompts 作为独立 message 注入
 */
function cardRecordToSlice(card: Record<string, unknown>): BoundCharacterSlice {
  const nameRaw = card.name
  const name =
    typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : undefined
  const cardBody = cardRecordToCharXmlBlock(card)
  const sp = card.system_prompt
  const systemPrompt =
    typeof sp === 'string' && sp.trim() ? sp.trim() : undefined
  const ph = card.post_history_instructions
  const postHistory =
    typeof ph === 'string' && ph.trim() ? ph.trim() : undefined
  return { name, cardBody, systemPrompt, postHistory }
}

function assistantTextFromTurn(t: TurnRecord): string {
  const rs = t.receives
  if (!Array.isArray(rs) || rs.length === 0) return ''
  const ai = Math.min(
    Math.max(0, Math.floor(t.activeReceiveIndex) || 0),
    rs.length - 1,
  )
  const c = rs[ai]?.content
  return typeof c === 'string' ? c : ''
}

/**
 * 尾块中的 turns → 与前端 turnsToHistoryMessages 一致的多轮 user/assistant 序列。
 * @param historyBeforeTurnOrdinalExclusive 若给出，仅包含 turnOrdinal 小于该值的轮次（再生等）。
 */
export function chunkTurnsToHistoryMessages(
  chunk: ChunkFile | null,
  historyBeforeTurnOrdinalExclusive?: number,
): ChatMessage[] {
  if (!chunk || !Array.isArray(chunk.turns)) return []
  let rows = chunk.turns.slice()
  if (
    typeof historyBeforeTurnOrdinalExclusive === 'number' &&
    !Number.isNaN(historyBeforeTurnOrdinalExclusive)
  ) {
    rows = rows.filter(
      (t) => t.turnOrdinal < historyBeforeTurnOrdinalExclusive,
    )
  }
  rows.sort((a, b) => a.turnOrdinal - b.turnOrdinal)
  const out: ChatMessage[] = []
  for (const turn of rows) {
    const u = getTurnUserText(turn)
    if (u.trim().length > 0) {
      out.push({ role: 'user', content: u })
    }
    if (Array.isArray(turn.receives) && turn.receives.length > 0) {
      const assistant = assistantTextFromTurn(turn).trim()
      if (assistant.length > 0) {
        out.push({ role: 'assistant', content: assistant })
      }
    }
  }
  return out
}

async function loadBoundCharacterSlices(ids: string[]): Promise<BoundCharacterSlice[]> {
  const out: BoundCharacterSlice[] = []
  for (const id of ids) {
    const doc = await readCharacterDocument(id.trim())
    if (!doc?.card || typeof doc.card !== 'object') continue
    out.push(cardRecordToSlice(doc.card as Record<string, unknown>))
  }
  return out
}

const TRIGGERS: PromptTrigger[] = [
  'normal',
  'continue',
  'swipe',
  'regenerate',
]

function normalizeTrigger(raw: unknown): PromptTrigger {
  if (typeof raw === 'string' && (TRIGGERS as string[]).includes(raw)) {
    return raw as PromptTrigger
  }
  return 'normal'
}

export interface BuildConversationMessagesParams {
  conversationId: string
  userText: string
  promptTrigger?: unknown
  /** 仅包含尾块中 turnOrdinal 小于该值的轮次作为 history（再生时传当前轮的 ordinal） */
  historyBeforeTurnOrdinalExclusive?: number | null
  contextLength?: number | null
}

export interface BuildConversationMessagesResult {
  messages: ChatMessage[]
  estimatedTokens: number
  droppedHistoryCount: number
}

/**
 * 读会话索引、尾块、当前用户的 prompts 目录、绑定角色卡，在服务端组装发往模型的 messages。
 */
export async function buildConversationOutboundMessages(
  params: BuildConversationMessagesParams & { promptsDoc: PromptsDocument },
): Promise<BuildConversationMessagesResult | { error: string; status: number }> {
  const conversationId = params.conversationId.trim()
  if (!conversationId) {
    return { error: 'conversationId 无效', status: 400 }
  }

  const idx = await readConversationIndex(conversationId)
  if (!idx) {
    return { error: '会话不存在', status: 404 }
  }

  const doc = params.promptsDoc
  const preset = pickPresetForConversation(idx, doc)
  if (!preset) {
    return { error: '无法解析提示词预设', status: 400 }
  }

  const chunk = await readTailChunk(conversationId)
  const history = chunkTurnsToHistoryMessages(
    chunk,
    params.historyBeforeTurnOrdinalExclusive ?? undefined,
  )

  const charIds = resolvedCharacterIds(idx)
  const characters = await loadBoundCharacterSlices(charIds)
  const charCtx =
    characters.length > 0 ? { characters } satisfies { characters: BoundCharacterSlice[] } : {}

  const userInput = typeof params.userText === 'string' ? params.userText : ''
  const trigger = normalizeTrigger(params.promptTrigger)
  const maxT = params.contextLength
  const maxTokens =
    typeof maxT === 'number' && !Number.isNaN(maxT) && maxT > 0
      ? maxT
      : undefined

  const macroContext = buildPromptMacroContext({
    conversationUserName: idx.userName,
    characters,
  })

  const result = assemblePrompts(preset, {
    trigger,
    history,
    userInput,
    maxTokens,
    macroContext,
    ...charCtx,
  })

  return {
    messages: result.messages,
    estimatedTokens: result.estimatedTokens,
    droppedHistoryCount: result.droppedHistoryCount,
  }
}
