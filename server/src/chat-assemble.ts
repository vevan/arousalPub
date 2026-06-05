import { ApiErrorCodes } from './api-error-codes.js'
import {
  assemblePrompts,
  type BoundCharacterSlice,
  type ChatMessage,
  type PromptPreset,
  type PromptTrigger,
} from './assemble-prompts.js'
import { buildPromptMacroContext } from './prompt-macros/index.js'
import {
  authorsNoteForInjection,
  authorsNoteMacroText,
} from './authors-note-settings.js'
import { cardRecordToCharXmlBlock, cardRecordToUserXmlBlock } from './prompt-xml.js'
import {
  readConversationIndex,
  resolvedCharacterIds,
  resolvedLorebookIds,
  type ConversationIndex,
} from './chat-storage.js'
import { readCharacterDocument } from './character-storage.js'
import type { PromptsDocument } from './prompts-file.js'
import { resolveLorebookSettings } from './lorebook-settings.js'
import { resolveLorebookInjectionText } from './lorebook-resolve.js'
import { resolveHistorySettings } from './history-settings.js'
import { resolveMemorySettings } from './memory-settings.js'
import { buildScanText } from './lore-scan.js'
import { runMemoryPipeline } from './memory-pipeline.js'
import {
  readGlobalHistorySettings,
  readGlobalLorebookSettings,
  readGlobalMemorySettings,
} from './user-preferences-file.js'
import { normalizePresetForAssemble } from './prompt-preset-normalize.js'
import { applyPluginsAfterAssemblePrompts } from './plugin-host.js'
import type { ChatPluginsBody } from './plugin-types.js'
import { countChatMessagesTokens } from './token-count.js'

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

async function loadBoundCharacterSlices(ids: string[]): Promise<BoundCharacterSlice[]> {
  const out: BoundCharacterSlice[] = []
  for (const id of ids) {
    const doc = await readCharacterDocument(id.trim())
    if (!doc?.card || typeof doc.card !== 'object') continue
    out.push(cardRecordToSlice(doc.card as Record<string, unknown>))
  }
  return out
}

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
  historyBeforeTurnOrdinalExclusive?: number | null
  contextLength?: number | null
  tokenModel?: string | null
  plugins?: ChatPluginsBody | null
}

export interface BuildConversationMessagesResult {
  messages: ChatMessage[]
  estimatedTokens: number
  droppedHistoryCount: number
  droppedMemoryCount: number
  memoryTurnIds?: string[]
  memoryText?: string
}

export async function buildConversationOutboundMessages(
  params: BuildConversationMessagesParams & { promptsDoc: PromptsDocument },
): Promise<BuildConversationMessagesResult | { error: string; status: number }> {
  const conversationId = params.conversationId.trim()
  if (!conversationId) {
    return { error: ApiErrorCodes.invalid_conversation_id, status: 400 }
  }

  const idx = await readConversationIndex(conversationId)
  if (!idx) {
    return { error: ApiErrorCodes.conversation_not_found, status: 404 }
  }

  const doc = params.promptsDoc
  const picked = pickPresetForConversation(idx, doc)
  if (!picked) {
    return { error: ApiErrorCodes.prompt_preset_unresolved, status: 400 }
  }
  const preset = normalizePresetForAssemble(picked)

  const globalHistory = await readGlobalHistorySettings()
  const globalMemory = await readGlobalMemorySettings()
  const effectiveHistory = resolveHistorySettings(
    globalHistory,
    idx.historySettings,
  )
  const effectiveMemory = resolveMemorySettings(
    globalMemory,
    idx.memorySettings,
  )

  const userInput = typeof params.userText === 'string' ? params.userText : ''
  const maxT = params.contextLength
  const maxTokens =
    typeof maxT === 'number' && !Number.isNaN(maxT) && maxT > 0
      ? maxT
      : undefined

  const memoryPipeline = await runMemoryPipeline({
    conversationId,
    userText: userInput,
    memorySettings: effectiveMemory,
    historySettings: effectiveHistory,
    historyBeforeTurnOrdinalExclusive:
      params.historyBeforeTurnOrdinalExclusive ?? undefined,
    contextLength: maxTokens,
    tokenModel: params.tokenModel ?? undefined,
  })

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

  const trigger = normalizeTrigger(params.promptTrigger)

  const macroContext = buildPromptMacroContext({
    conversationUserName: idx.userName,
    characters,
    model: params.tokenModel ?? undefined,
    contextLength: maxTokens,
    authorsNote: authorsNoteMacroText(idx.authorsNote),
  })

  const authorsNote = authorsNoteForInjection(idx.authorsNote)

  const lorebookIds = resolvedLorebookIds(idx)
  const globalLore = await readGlobalLorebookSettings()
  const effectiveLore = resolveLorebookSettings(globalLore, idx.lorebookSettings)
  const scanCorpus = buildScanText(
    userInput,
    memoryPipeline.memoryText,
    memoryPipeline.recentHistoryScanText,
  )
  const worldText =
    lorebookIds.length > 0
      ? await resolveLorebookInjectionText(lorebookIds, {
          scanCorpus,
          lorebookSettings: effectiveLore,
        })
      : undefined

  const tokenModel =
    typeof params.tokenModel === 'string' && params.tokenModel.trim().length > 0
      ? params.tokenModel.trim()
      : undefined

  const result = assemblePrompts(preset, {
    trigger,
    userInput,
    maxTokens,
    tokenModel,
    macroContext,
    authorsNote: authorsNote ?? undefined,
    history:
      memoryPipeline.recentHistoryMessages.length > 0
        ? memoryPipeline.recentHistoryMessages
        : undefined,
    memoryText: memoryPipeline.memoryText || undefined,
    ...(worldText !== undefined && worldText.length > 0 ? { world: worldText } : {}),
    ...charCtx,
  })

  const messages = await applyPluginsAfterAssemblePrompts({
    messages: result.messages,
    macroContext,
    plugins: params.plugins,
  })
  const estimatedTokens =
    messages.length === result.messages.length
      ? result.estimatedTokens
      : countChatMessagesTokens(messages, { model: tokenModel })

  return {
    messages,
    estimatedTokens,
    droppedHistoryCount: result.droppedHistoryCount,
    droppedMemoryCount: memoryPipeline.droppedMemoryCount,
    memoryTurnIds: memoryPipeline.memoryTurnIds,
    memoryText: memoryPipeline.memoryText || undefined,
  }
}
