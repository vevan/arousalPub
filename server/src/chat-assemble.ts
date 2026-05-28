import {
  assemblePrompts,
  type BoundCharacterSlice,
  type ChatMessage,
  type PromptPreset,
  type PromptTrigger,
} from './assemble-prompts.js'
import { buildPromptMacroContext } from './prompt-macros/index.js'
import { cardRecordToCharXmlBlock, cardRecordToUserXmlBlock } from './prompt-xml.js'
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
import { listLorebookIds } from './lorebook-file.js'
import { resolveLorebookSettings } from './lorebook-settings.js'
import { resolveLorebookInjectionText } from './lorebook-resolve.js'
import {
  limitHistoryTurnRows,
  resolveHistorySettings,
  type HistorySettings,
} from './history-settings.js'
import {
  readGlobalHistorySettings,
  readGlobalLorebookSettings,
} from './user-preferences-file.js'
import { normalizePresetForAssemble } from './prompt-preset-normalize.js'

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
  historySettings?: HistorySettings,
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
  if (historySettings) {
    rows = limitHistoryTurnRows(rows, historySettings)
  }
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

/** 会话 userCharacterId → persona 切片；展示名优先用 userName 快照 */
async function loadUserCharacterSlice(
  idx: Pick<ConversationIndex, 'userCharacterId' | 'userName'>,
): Promise<BoundCharacterSlice | undefined> {
  const id =
    typeof idx.userCharacterId === 'string' ? idx.userCharacterId.trim() : ''
  if (!id) return undefined
  const doc = await readCharacterDocument(id)
  if (!doc?.card || typeof doc.card !== 'object') return undefined
  const card = doc.card as Record<string, unknown>
  const snap =
    typeof idx.userName === 'string' && idx.userName.trim()
      ? idx.userName.trim()
      : ''
  const nameRaw = card.name
  const nameFromCard =
    typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : ''
  const name = snap || nameFromCard || undefined
  const sp = card.system_prompt
  const systemPrompt =
    typeof sp === 'string' && sp.trim() ? sp.trim() : undefined
  return {
    name,
    cardBody: cardRecordToUserXmlBlock(card),
    systemPrompt,
  }
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
  /** 连接配置中的模型名，用于 tiktoken 词表 */
  tokenModel?: string | null
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
  const picked = pickPresetForConversation(idx, doc)
  if (!picked) {
    return { error: '无法解析提示词预设', status: 400 }
  }
  const preset = normalizePresetForAssemble(picked)

  const chunk = await readTailChunk(conversationId)
  const globalHistory = await readGlobalHistorySettings()
  const effectiveHistory = resolveHistorySettings(
    globalHistory,
    idx.historySettings,
  )
  const history = chunkTurnsToHistoryMessages(
    chunk,
    params.historyBeforeTurnOrdinalExclusive ?? undefined,
    effectiveHistory,
  )

  const charIds = resolvedCharacterIds(idx)
  const [userCharacter, characters] = await Promise.all([
    loadUserCharacterSlice(idx),
    loadBoundCharacterSlices(charIds),
  ])
  const charCtx: {
    userCharacter?: BoundCharacterSlice
    characters?: BoundCharacterSlice[]
  } = {}
  if (userCharacter) charCtx.userCharacter = userCharacter
  if (characters.length > 0) charCtx.characters = characters

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
    model: params.tokenModel ?? undefined,
    contextLength: maxTokens,
  })

  const boundLorebookIds = Array.isArray(idx.lorebookIds)
    ? idx.lorebookIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
  // 会话未显式绑定时，回退为全部已保存世界书（避免编辑了世界书却忘记在对话设置里勾选）
  const lorebookIds =
    boundLorebookIds.length > 0 ? boundLorebookIds : await listLorebookIds()
  const globalLore = await readGlobalLorebookSettings()
  const effectiveLore = resolveLorebookSettings(globalLore, idx.lorebookSettings)
  const worldText =
    lorebookIds.length > 0
      ? await resolveLorebookInjectionText(lorebookIds, {
          userText: userInput,
          lorebookSettings: effectiveLore,
        })
      : undefined

  const tokenModel =
    typeof params.tokenModel === 'string' && params.tokenModel.trim().length > 0
      ? params.tokenModel.trim()
      : undefined

  const result = assemblePrompts(preset, {
    trigger,
    history,
    userInput,
    maxTokens,
    tokenModel,
    macroContext,
    ...(worldText !== undefined && worldText.length > 0 ? { world: worldText } : {}),
    ...charCtx,
  })

  return {
    messages: result.messages,
    estimatedTokens: result.estimatedTokens,
    droppedHistoryCount: result.droppedHistoryCount,
  }
}
