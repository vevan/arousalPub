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
import { resolveLorebookInjectionParts } from './lorebook-resolve.js'
import { resolveHistorySettings } from './history-settings.js'
import { resolveMemorySettings } from './memory-settings.js'
import { buildScanText } from './lore-scan.js'
import { runMemoryPipeline } from './memory-pipeline.js'
import {
  readGlobalBudgetTrimSettings,
  readGlobalHistorySettings,
  readGlobalLorebookSettings,
  readGlobalMemorySettings,
} from './user-preferences-file.js'
import { resolveBudgetTrimSettings } from './budget-trim-settings.js'
import { normalizePresetForAssemble } from './prompt-preset-normalize.js'
import { readApiSettingsFromFile } from './api-settings-file.js'
import {
  resolveFeatureApi,
  toResolvedFeatureAudit,
  type ResolvedFeatureAudit,
} from './feature-binding-resolve.js'
import { applyPluginsAfterAssemblePrompts } from './plugin-host.js'
import type { ChatPluginsBody } from './plugin-types.js'
import { countChatMessagesTokens } from './token-count.js'
import {
  memoryTextFromTrimState,
  runPromptBudgetTrimLoop,
  type PromptBudgetTrimState,
  worldTextFromTrimState,
} from './prompt-budget-trim.js'

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
  droppedLoreCount: number
  droppedHistoryCount: number
  droppedMemoryCount: number
  memoryTurnIds?: string[]
  memoryText?: string
  /** 已配置 rag_generate 时返回；独立知识库 RAG 未接线前仅作占位审计 */
  resolvedRagGenerate?: ResolvedFeatureAudit
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

  let resolvedRagGenerate: ResolvedFeatureAudit | undefined
  const apiSettings = await readApiSettingsFromFile()
  if (apiSettings) {
    const ragMeta = resolveFeatureApi(apiSettings, 'rag_generate', {
      conversationApiPreset: idx.apiPreset,
    })
    if (ragMeta) {
      resolvedRagGenerate = toResolvedFeatureAudit(ragMeta)
      // P4.1 占位：独立知识库 RAG 未落地前不向 messages 注入检索结果
    }
  }

  const doc = params.promptsDoc
  const picked = pickPresetForConversation(idx, doc)
  if (!picked) {
    return { error: ApiErrorCodes.prompt_preset_unresolved, status: 400 }
  }
  const preset = normalizePresetForAssemble(picked)

  const globalHistory = await readGlobalHistorySettings()
  const globalMemory = await readGlobalMemorySettings()
  const globalBudgetTrim = await readGlobalBudgetTrimSettings()
  const effectiveHistory = resolveHistorySettings(
    globalHistory,
    idx.historySettings,
  )
  const effectiveMemory = resolveMemorySettings(
    globalMemory,
    idx.memorySettings,
  )
  const effectiveBudgetTrim = resolveBudgetTrimSettings(
    globalBudgetTrim,
    idx.budgetTrimSettings,
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
    activeBranchPath: idx.activeBranchPath ?? '',
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
  const loreParts =
    lorebookIds.length > 0
      ? await resolveLorebookInjectionParts(lorebookIds, {
          scanCorpus,
          conversationId,
          lorebookSettings: effectiveLore,
        })
      : { constantLoreGroups: [], matchedLore: [] }

  const tokenModel =
    typeof params.tokenModel === 'string' && params.tokenModel.trim().length > 0
      ? params.tokenModel.trim()
      : undefined

  const trimState: PromptBudgetTrimState = {
    constantLoreGroups: loreParts.constantLoreGroups,
    matchedLore: loreParts.matchedLore.slice(),
    memoryItems: memoryPipeline.memoryItems.slice(),
    historyMessages: memoryPipeline.recentHistoryMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  }

  const assembleCtxBase = {
    trigger,
    userInput,
    tokenModel,
    macroContext,
    authorsNote: authorsNote ?? undefined,
    skipInternalBudgetTrim: true as const,
    ...charCtx,
  }

  const assembleFromState = (state: PromptBudgetTrimState): ChatMessage[] => {
    const worldText = worldTextFromTrimState(state)
    const memoryText = memoryTextFromTrimState(state)
    return assemblePrompts(preset, {
      ...assembleCtxBase,
      history:
        state.historyMessages.length > 0 ? state.historyMessages : undefined,
      memoryText: memoryText || undefined,
      ...(worldText.length > 0 ? { world: worldText } : {}),
    }).messages
  }

  let messages: ChatMessage[]
  let estimatedTokens: number
  let droppedLoreCount = 0
  let droppedMemoryCount = 0
  let droppedHistoryCount = 0

  if (maxTokens) {
    const trimmed = runPromptBudgetTrimLoop({
      maxTokens,
      tokenModel,
      trimSettings: effectiveBudgetTrim,
      state: trimState,
      assembleMessages: assembleFromState,
    })
    messages = trimmed.messages
    estimatedTokens = trimmed.estimatedTokens
    droppedLoreCount = trimmed.drops.droppedLoreCount
    droppedMemoryCount = trimmed.drops.droppedMemoryCount
    droppedHistoryCount = trimmed.drops.droppedHistoryCount
  } else {
    messages = assembleFromState(trimState)
    estimatedTokens = countChatMessagesTokens(messages, { model: tokenModel })
  }

  const messagesAfterPlugins = await applyPluginsAfterAssemblePrompts({
    messages,
    macroContext,
    plugins: params.plugins,
  })
  const finalEstimatedTokens =
    messagesAfterPlugins.length === messages.length
      ? estimatedTokens
      : countChatMessagesTokens(messagesAfterPlugins, { model: tokenModel })

  const finalMemoryText = memoryTextFromTrimState(trimState)

  return {
    messages: messagesAfterPlugins,
    estimatedTokens: finalEstimatedTokens,
    droppedLoreCount,
    droppedHistoryCount,
    droppedMemoryCount,
    memoryTurnIds: trimState.memoryItems.map((x) => x.turn.turnId),
    memoryText: finalMemoryText || undefined,
    ...(resolvedRagGenerate ? { resolvedRagGenerate } : {}),
  }
}
