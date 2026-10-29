import { ApiErrorCodes } from './api-error-codes.js'
import { isMemoryVectorIndexCorruptError } from './memory-vector-index-error.js'
import {
  assemblePrompts,
  compactEmptyMessages,
  type BoundCharacterSlice,
  type ChatMessage,
  type PromptPreset,
  type PromptTrigger,
} from './assemble-prompts.js'
import { buildPromptMacroContext } from './prompt-macros/index.js'
import { patchPromptMacroHistoryFields } from './prompt-macros/context.js'
import { loadCharFileLookupsForIds } from './load-char-file-lookups.js'
import { buildMacroHistoryFields, type TrimmedHistoryMessage } from './prompt-macros/history-macros.js'
import { extractMacroCharacterFields } from './prompt-macros/index.js'
import { applyMacrosToMessages } from './prompt-macros/index.js'
import {
  loadMacroGlobalVarsForContext,
  loadMacroLocalVarsForConversation,
  persistMacroVarMutations,
} from './prompt-macros/macro-vars-persist.js'
import {
  authorsNoteForInjection,
  authorsNoteMacroText,
  defaultAuthorsNoteMacroText,
} from './authors-note-settings.js'
import { cardRecordToCharXmlBlock, cardRecordToUserXmlBlock } from './prompt-xml.js'
import {
  readConversationIndex,
  resolvedCharacterIds,
  resolvedLorebookIds,
  getTurnUserText,
  type ConversationIndex,
  type TurnRecord,
} from './chat-storage.js'
import { readChunkContainingOrdinal } from './chunk-chain.js'
import { resolveConversationTailOrdinal } from './regex-persist-patch.js'
import {
  buildGroupMacroStrings,
  buildGroupChatNotChar,
  groupChatAssembleInstruction,
  normalizeGroupChatSettings,
  parseGroupContinueBody,
  resolveOutboundSpeakerCharacterId,
  type GroupContinueBody,
} from './group-chat-turn.js'
import {
  loadCharacterDisplayNamesForIds,
  readCharacterDocument,
} from './character-storage.js'
import type { PromptsDocument } from './prompts-file.js'
import { resolveLorebookSettings } from './lorebook-settings.js'
import { resolveLorebookInjectionParts } from './lorebook-resolve.js'
import { readLorebooksByIds } from './lorebook-file.js'
import {
  buildAssemblyAudit,
  historyTurnOrdinalsFromMessages,
  resolveHistoryTrimAudit,
} from './build-assembly-audit.js'
import { isAuditDebugWriteEnabled } from './chat-audit-file.js'
import type {
  AssemblyAudit,
  AssemblyTimingMs,
  CallAuditEntry,
  PerformanceAudit,
} from './chat-audit-types.js'
import { resolveHistorySettings } from './history-settings.js'
import { resolveMemorySettings } from './memory-settings.js'
import { buildScanText } from './lore-scan.js'
import { runMemoryPipeline } from './memory-pipeline.js'
import {
  readGlobalBudgetTrimSettings,
  readGlobalDefaultAuthorsNote,
  readGlobalHistorySettings,
  readGlobalKnowledgeSettings,
  readGlobalLorebookSettings,
  readGlobalMemorySettings,
  readGlobalHybridFtsSettings,
  readGlobalPostUserInjectionOrderHostPolicy,
} from './user-preferences-file.js'
import { resolveBudgetTrimSettings } from './budget-trim-settings.js'
import { normalizePresetForAssemble } from './prompt-preset-normalize.js'
import { readApiSettingsFromFile } from './api-settings-file.js'
import {
  parseHybridFtsSettingsStrict,
  resolveEffectiveHybridFtsSettings,
} from './hybrid-fts-settings.js'
import {
  resolveFeatureApi,
  toResolvedFeatureAudit,
  type ResolvedFeatureAudit,
} from './feature-binding-resolve.js'
import {
  applyPluginsAfterAssemblePrompts,
  type PluginAssembleAdditionCache,
} from './plugin-host.js'
import type { ChatPluginsBody } from './plugin-types.js'
import { countChatMessagesTokens } from './token-count.js'
import { readTurnsInOrdinalRange } from './chunk-chain.js'
import { loadTurnsForMacroIndexing } from './prompt-macros/macro-indexing-turns.js'
import { readPluginRegistry } from './plugin-system/registry.js'
import {
  knowledgeTextFromTrimState,
  memoryTextFromTrimState,
  type PromptBudgetTrimState,
  worldTextsFromTrimState,
} from './prompt-budget-trim.js'
import { trimAssembledMessagesWithPromptSlots } from './prompt-slots.js'
import { recallKnowledgeForConversation } from './knowledge-resolve.js'
import {
  normalizeKnowledgeSettings,
  resolveKnowledgeSettings,
} from './knowledge-settings.js'
import {
  loadAndApplyRegexOutgoing,
  resolveOutgoingTailOrdinal,
  type OutgoingRegexContext,
} from './regex-outgoing.js'

async function loadActiveTurnForMacro(
  conversationId: string,
  beforeExclusive?: number | null,
  trigger?: PromptTrigger,
): Promise<TurnRecord | null> {
  if (trigger !== 'regenerate' && trigger !== 'swipe') return null
  if (
    typeof beforeExclusive !== 'number' ||
    Number.isNaN(beforeExclusive)
  ) {
    return null
  }
  const turns = await readTurnsInOrdinalRange(
    conversationId,
    beforeExclusive,
    beforeExclusive,
  )
  return turns[0] ?? null
}

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

function trimmedHistoryForMacros(messages: ChatMessage[]): TrimmedHistoryMessage[] {
  return messages.flatMap((m) =>
    m.role === 'user' || m.role === 'assistant'
      ? [
          {
            role: m.role,
            content: m.content,
            turnId: m.turnId,
            turnOrdinal: m.turnOrdinal,
            receiveId: m.receiveId,
            receiveIndex: m.receiveIndex,
          },
        ]
      : [],
  )
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
  return {
    name,
    cardBody,
    systemPrompt,
    postHistory,
    macroFields: extractMacroCharacterFields(card),
  }
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
    macroFields: extractMacroCharacterFields(card),
  }
}

function resolveMaxResponseTokensFromPanel(
  maxResponseTokens: number | null | undefined,
): number | undefined {
  if (
    typeof maxResponseTokens === 'number' &&
    !Number.isNaN(maxResponseTokens) &&
    maxResponseTokens > 0
  ) {
    return Math.floor(maxResponseTokens)
  }
  return undefined
}

const TRIGGERS: PromptTrigger[] = [
  'normal',
  'continue',
  'swipe',
  'regenerate',
  'groupContinue',
]

function normalizeTrigger(raw: unknown): PromptTrigger {
  if (typeof raw === 'string' && (TRIGGERS as string[]).includes(raw)) {
    return raw as PromptTrigger
  }
  return 'normal'
}

function macroHistoryFieldsWithGroupNotChar(params: {
  indexingTurns: TurnRecord[]
  historyTurns: TurnRecord[]
  activeTurn?: TurnRecord | null
  trimmedHistoryMessages?: TrimmedHistoryMessage[]
  characterNames: string[]
  groupChatEnabled: boolean
  characterIds: string[]
  boundCharacterNames: string[]
  speakerCharacterId: string
}) {
  const {
    groupChatEnabled,
    characterIds,
    boundCharacterNames,
    speakerCharacterId,
    ...historyParams
  } = params
  const fields = buildMacroHistoryFields(historyParams)
  fields.notChar = buildGroupChatNotChar({
    groupChatEnabled,
    characterIds,
    characterNames: boundCharacterNames,
    speakerCharacterId,
  })
  return fields
}

export interface BuildConversationMessagesParams {
  conversationId: string
  userText: string
  promptTrigger?: unknown
  historyBeforeTurnOrdinalExclusive?: number | null
  historyPartialTurn?: { turnOrdinal: number; segmentIndexExclusive: number }
  /** 当前生成 segment 的 speaker（{{char}}） */
  speakerCharacterId?: string
  /** 群聊：/@ 解析后的 characterId 队列 */
  speakerQueue?: string[]
  /** 群聊：/@ displayName 队列（服务端解析为 characterId） */
  speakerQueueDisplayNames?: string[]
  groupContinue?: GroupContinueBody
  regenerateSegmentIndex?: number
  regenerateTurnOrdinal?: number | null
  contextLength?: number | null
  /** 面板快照 maxTokens → {{maxResponseTokens}}；勿再读会话磁盘绑定 */
  maxResponseTokens?: number | null
  tokenModel?: string | null
  plugins?: ChatPluginsBody | null
}

export interface BuildConversationMessagesResult {
  messages: ChatMessage[]
  estimatedTokens: number
  droppedLoreCount: number
  droppedHistoryCount: number
  droppedMemoryCount: number
  droppedKnowledgeCount: number
  memoryTurnIds?: string[]
  memoryText?: string
  /** 已配置 rag_generate 时返回；独立知识库 RAG 未接线前仅作占位审计 */
  resolvedRagGenerate?: ResolvedFeatureAudit
  /** debug 审计：组装命中明细（由调用方决定是否落盘） */
  assemblyAudit?: AssemblyAudit
  /** debug 审计：本轮组装阶段的 embedding 调用 */
  assemblyEmbeddingCalls?: CallAuditEntry[]
  /** debug 审计：组装阶段耗时 */
  performanceAudit?: PerformanceAudit
  /** 本轮 outbound {{char}} / 首段 speaker（掷骰或队列解析结果） */
  speakerCharacterId?: string
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
  const globalHybridFts = await readGlobalHybridFtsSettings()
  const globalBudgetTrim = await readGlobalBudgetTrimSettings()
  const hostInjectionOrderPolicy = await readGlobalPostUserInjectionOrderHostPolicy()
  const effectiveHistory = resolveHistorySettings(
    globalHistory,
    idx.historySettings,
  )
  const effectiveMemory = resolveMemorySettings(
    globalMemory,
    idx.memorySettings,
  )
  const effectiveMemoryHybridFts = resolveEffectiveHybridFtsSettings(
    globalHybridFts,
    parseHybridFtsSettingsStrict(idx.memoryHybridFts),
  )
  const effectiveBudgetTrim = resolveBudgetTrimSettings(
    globalBudgetTrim,
    idx.budgetTrimSettings,
  )

  const charIds = resolvedCharacterIds(idx)
  const defaultSpeakerId = charIds[0]?.trim() ?? ''
  const groupChat = normalizeGroupChatSettings(idx.groupChat)
  const groupContinue = params.groupContinue
  let userInput = typeof params.userText === 'string' ? params.userText : ''
  /** 记忆召回 query；与组装 userInput 槽分离，避免 partial history 重复 user */
  let memoryQueryText = userInput
  let historyBeforeEx = params.historyBeforeTurnOrdinalExclusive ?? undefined
  let historyPartialTurn = params.historyPartialTurn
  let speakerCharacterId = params.speakerCharacterId?.trim() ?? ''

  if (!speakerCharacterId && !groupContinue) {
    const charNames = await loadCharacterDisplayNamesForIds(charIds)
    const tailOrd = await resolveConversationTailOrdinal(conversationId)
    const newTurnOrdinal = tailOrd < 0 ? 0 : tailOrd + 1
    if (
      groupChat.enabled ||
      params.speakerQueue?.length ||
      params.speakerQueueDisplayNames?.length
    ) {
      speakerCharacterId = resolveOutboundSpeakerCharacterId({
        groupChatEnabled: Boolean(groupChat.enabled),
        groupChat,
        characterIds: charIds,
        characterNames: charNames,
        defaultCharacterId: defaultSpeakerId,
        conversationId,
        turnOrdinal: newTurnOrdinal,
        speakerQueueIds: params.speakerQueue,
        speakerQueueDisplayNames: params.speakerQueueDisplayNames,
      })
    }
  }
  if (!speakerCharacterId) speakerCharacterId = defaultSpeakerId

  if (groupContinue) {
    const turnOrd = groupContinue.turnOrdinal
    const located = await readChunkContainingOrdinal(conversationId, turnOrd)
    const turn = located?.chunk.turns.find((t) => t.turnOrdinal === turnOrd)
    if (!turn) {
      return { error: ApiErrorCodes.regenerate_turn_not_found, status: 404 }
    }
    memoryQueryText = userInput.trim() || getTurnUserText(turn)
    speakerCharacterId = groupContinue.speakerCharacterId.trim()
    historyBeforeEx = turnOrd + 1
    historyPartialTurn = {
      turnOrdinal: turnOrd,
      segmentIndexExclusive: groupContinue.afterSegmentIndex + 1,
    }
  } else if (
    typeof params.regenerateTurnOrdinal === 'number' &&
    typeof params.regenerateSegmentIndex === 'number' &&
    params.regenerateSegmentIndex > 0
  ) {
    historyBeforeEx = params.regenerateTurnOrdinal + 1
    historyPartialTurn = {
      turnOrdinal: params.regenerateTurnOrdinal,
      segmentIndexExclusive: params.regenerateSegmentIndex,
    }
  }

  if (historyPartialTurn) {
    // partial history 已含该轮 user；userInput 槽留空，避免 user/assistant/user 重复
    userInput = ''
  }

  const maxT = params.contextLength
  const maxTokens =
    typeof maxT === 'number' && !Number.isNaN(maxT) && maxT > 0
      ? maxT
      : undefined

  const auditEnabled = isAuditDebugWriteEnabled(idx)
  const assemblyStartedAt = auditEnabled ? performance.now() : 0

  let memoryPipeline
  let indexingTurns: TurnRecord[] = []
  let enabledPluginIds: string[] = []
  try {
    const beforeEx = historyBeforeEx
    ;[memoryPipeline, indexingTurns, enabledPluginIds] = await Promise.all([
      runMemoryPipeline({
        conversationId,
        userText: memoryQueryText,
        memorySettings: effectiveMemory,
        memoryHybridFts: effectiveMemoryHybridFts,
        historySettings: effectiveHistory,
        historyBeforeTurnOrdinalExclusive: beforeEx,
        historyPartialTurn,
        defaultSpeakerCharacterId: defaultSpeakerId,
        activeBranchPath: idx.activeBranchPath ?? '',
      }),
      loadTurnsForMacroIndexing(conversationId, beforeEx),
      readPluginRegistry().then((reg) =>
        reg.plugins.filter((p) => p.enabled).map((p) => p.id),
      ),
    ])
  } catch (e) {
    if (isMemoryVectorIndexCorruptError(e)) {
      return {
        error: ApiErrorCodes.memory_vector_index_corrupt,
        status: 503,
      }
    }
    throw e
  }
  const afterMemoryAt = auditEnabled ? performance.now() : 0

  const [userCharacter, characters] = await Promise.all([
    loadUserCharacterSlice(idx),
    loadBoundCharacterSlices(charIds),
  ])
  const afterCharactersAt = auditEnabled ? performance.now() : 0

  let macroCharacters = characters
  let macroCharNameList = characters
    .map((c) => c.name?.trim())
    .filter((n): n is string => Boolean(n))
  let primaryMacroFields = characters[0]?.macroFields
  const speakerIdx = charIds.indexOf(speakerCharacterId)
  if (speakerIdx > 0 && characters[speakerIdx]) {
    macroCharacters = [
      characters[speakerIdx]!,
      ...characters.slice(0, speakerIdx),
      ...characters.slice(speakerIdx + 1),
    ]
    macroCharNameList = macroCharacters
      .map((c) => c.name?.trim())
      .filter((n): n is string => Boolean(n))
    primaryMacroFields = characters[speakerIdx]?.macroFields
  }

  const charCtx: {
    userCharacter?: BoundCharacterSlice
    characters?: BoundCharacterSlice[]
  } = {}
  if (userCharacter) charCtx.userCharacter = userCharacter
  if (macroCharacters.length > 0) charCtx.characters = macroCharacters

  const trigger = normalizeTrigger(params.promptTrigger)

  const globalDefaultAuthorsNote = await readGlobalDefaultAuthorsNote()

  const activeTurn = await loadActiveTurnForMacro(
    conversationId,
    params.historyBeforeTurnOrdinalExclusive,
    trigger,
  )

  const charNameList = macroCharNameList
  const boundCharacterNames = charIds.map((id, i) => {
    const n = characters[i]?.name?.trim()
    return n || id
  })

  const groupMacroStrings = buildGroupMacroStrings(
    charIds,
    boundCharacterNames,
    groupChat,
  )

  const historyFields = macroHistoryFieldsWithGroupNotChar({
    indexingTurns,
    historyTurns: memoryPipeline.recentTurns,
    activeTurn,
    characterNames: charNameList,
    groupChatEnabled: Boolean(groupChat.enabled),
    characterIds: charIds,
    boundCharacterNames,
    speakerCharacterId,
  })

  const [macroLocalVars, macroGlobalVars, fileLookups] = await Promise.all([
    loadMacroLocalVarsForConversation(conversationId),
    loadMacroGlobalVarsForContext(),
    loadCharFileLookupsForIds(charIds, idx.userCharacterId),
  ])

  let macroContext = buildPromptMacroContext({
    conversationUserName: idx.userName,
    characters: macroCharacters,
    primaryCharacter: primaryMacroFields ?? undefined,
    userCharacter,
    model: params.tokenModel ?? undefined,
    contextLength: maxTokens,
    maxResponseTokens: resolveMaxResponseTokensFromPanel(
      params.maxResponseTokens,
    ),
    userInput,
    promptTrigger: trigger,
    authorsNote: authorsNoteMacroText(idx.authorsNote),
    defaultAuthorsNote: defaultAuthorsNoteMacroText(globalDefaultAuthorsNote),
    conversationId,
    historyFields,
    enabledPluginIds,
    macroLocalVars,
    macroGlobalVars,
    group: groupMacroStrings.group,
    groupNotMuted: groupMacroStrings.groupNotMuted,
    groupChatEnabled: Boolean(groupChat.enabled),
    charFileLookups: fileLookups.charFileLookups,
    userFileLookup: fileLookups.userFileLookup,
  })

  const authorsNote = authorsNoteForInjection(idx.authorsNote)
  const groupChatInstruction = groupChatAssembleInstruction(groupChat)

  const lorebookIds = resolvedLorebookIds(idx)
  const globalLore = await readGlobalLorebookSettings()
  const effectiveLore = resolveLorebookSettings(globalLore, idx.lorebookSettings)
  const scanCorpus = buildScanText(
    userInput,
    memoryPipeline.memoryScanText,
    memoryPipeline.recentHistoryScanText,
  )
  const lorebooks =
    lorebookIds.length > 0 ? await readLorebooksByIds(lorebookIds) : []
  const lorebookNameToId = new Map(
    lorebooks.map((lb) => [lb.name.trim() || lb.id, lb.id]),
  )
  const loreParts =
    lorebookIds.length > 0
      ? await resolveLorebookInjectionParts(lorebookIds, {
          scanCorpus,
          conversationId,
          lorebookSettings: effectiveLore,
        })
      : { constantLore: [], matchedLore: [] }
  const afterLoreAt = auditEnabled ? performance.now() : 0

  const kbIds = Array.isArray(idx.knowledgeBaseIds) ? idx.knowledgeBaseIds : []
  const globalKnowledge = await readGlobalKnowledgeSettings()
  const effectiveKnowledge = resolveKnowledgeSettings(
    normalizeKnowledgeSettings(globalKnowledge),
    idx.knowledgeSettings,
  )
  const knowledgeRecall = kbIds.length
    ? await recallKnowledgeForConversation({
        knowledgeBaseIds: kbIds,
        queryText: scanCorpus || memoryQueryText,
        conversationId,
        knowledgeSettings: idx.knowledgeSettings,
      })
    : { items: [], knowledgeText: '' }
  const afterKnowledgeAt = auditEnabled ? performance.now() : 0

  const initialMatchedLore = loreParts.matchedLore.slice()
  const initialMemoryItems = memoryPipeline.memoryItems.slice()
  const initialKnowledgeItems = knowledgeRecall.items.slice()

  const tokenModel =
    typeof params.tokenModel === 'string' && params.tokenModel.trim().length > 0
      ? params.tokenModel.trim()
      : undefined

  const trimState: PromptBudgetTrimState = {
    constantLore: loreParts.constantLore,
    matchedLore: loreParts.matchedLore.slice(),
    memoryItems: memoryPipeline.memoryItems.slice(),
    knowledgeItems: knowledgeRecall.items.slice(),
    historyMessages: memoryPipeline.recentHistoryMessages.map((m) => ({ ...m })),
  }
  const historyOrdinalsBeforeTrim = historyTurnOrdinalsFromMessages(
    trimState.historyMessages,
  )

  /** §14.4.1：包壳组装 → 插件入槽 → 宏 → regex 一次 → PromptSlot 裁切投影 */
  const assembleCtxBase = {
    trigger,
    userInput,
    tokenModel,
    macroContext,
    authorsNote: authorsNote ?? undefined,
    afterUserInput: groupChatInstruction
      ? { content: groupChatInstruction, role: 'system' as const }
      : undefined,
    skipInternalBudgetTrim: true as const,
    deferMacroExpansion: true as const,
    ...charCtx,
  }

  const { worldBefore, worldAfter } = worldTextsFromTrimState(trimState)
  const memoryText = memoryTextFromTrimState(trimState)
  const knowledgeText = knowledgeTextFromTrimState(trimState)
  let messages = assemblePrompts(preset, {
    ...assembleCtxBase,
    history:
      trimState.historyMessages.length > 0
        ? trimState.historyMessages
        : undefined,
    memoryText: memoryText || undefined,
    knowledgeText: knowledgeText || undefined,
    ...(worldBefore.length > 0 ? { worldBefore } : {}),
    ...(worldAfter.length > 0 ? { worldAfter } : {}),
  }).messages
  const afterBaseAssembleAt = auditEnabled ? performance.now() : 0
  const budgetTrimAssemblePasses = 1

  const pluginCache: PluginAssembleAdditionCache = new Map()

  const pluginAfterUserInputForApply = groupChatInstruction
    ? {
        content: groupChatInstruction,
        role: 'system' as const,
        ...(authorsNote?.injectionDepth === 0 && authorsNote.content.trim()
          ? { excludeContents: [authorsNote.content.trim()] }
          : {}),
      }
    : undefined

  const trimmedHistoryForPlugins = trimState.historyMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }))
  const historyForMacros = trimmedHistoryForMacros(trimState.historyMessages)

  messages = await applyPluginsAfterAssemblePrompts({
    messages,
    macroContext,
    plugins: params.plugins,
    tokenModel,
    additionCache: pluginCache,
    trimmedHistoryMessages: trimmedHistoryForPlugins,
    afterUserInput: pluginAfterUserInputForApply,
    hostInjectionOrderPolicy,
  })
  const afterPluginsAt = auditEnabled ? performance.now() : 0

  macroContext = patchPromptMacroHistoryFields(
    macroContext,
    macroHistoryFieldsWithGroupNotChar({
      indexingTurns,
      historyTurns: memoryPipeline.recentTurns,
      activeTurn,
      trimmedHistoryMessages: historyForMacros,
      characterNames: charNameList,
      groupChatEnabled: Boolean(groupChat.enabled),
      characterIds: charIds,
      boundCharacterNames,
      speakerCharacterId,
    }),
  )
  applyMacrosToMessages(messages, macroContext)
  const afterMacrosAt = auditEnabled ? performance.now() : 0

  const tailOrdinal = resolveOutgoingTailOrdinal({
    sourceHistoryTurnOrdinals: memoryPipeline.recentHistoryTurnOrdinals,
    historyBeforeTurnOrdinalExclusive: params.historyBeforeTurnOrdinalExclusive,
  })
  const outgoingRegexCtx: OutgoingRegexContext = {
    tailOrdinal,
    sourceHistoryMessages: memoryPipeline.recentHistoryMessages.map((m) => ({
      ...m,
    })),
    sourceHistoryTurnOrdinals: memoryPipeline.recentHistoryTurnOrdinals,
    trimmedHistoryMessages: historyForMacros,
    memoryItems: trimState.memoryItems,
    userInput,
    macroContext,
  }
  messages = await loadAndApplyRegexOutgoing(messages, outgoingRegexCtx)
  const afterRegexAt = auditEnabled ? performance.now() : 0

  const trimMaxTokens =
    maxTokens != null && maxTokens > 0 ? maxTokens : undefined
  const trimMaxTokensForAudit =
    typeof trimMaxTokens === 'number' && trimMaxTokens > 0
      ? trimMaxTokens
      : undefined

  let droppedLoreCount = 0
  let droppedMemoryCount = 0
  let droppedKnowledgeCount = 0
  let droppedHistoryCount = 0
  let tokensBeforeTrim = countChatMessagesTokens(messages, {
    model: tokenModel,
  })
  let estimatedTokens = tokensBeforeTrim

  if (trimMaxTokens) {
    const trimmed = trimAssembledMessagesWithPromptSlots({
      messages,
      state: trimState,
      maxTokens: trimMaxTokens,
      trimSettings: effectiveBudgetTrim,
      tokenModel,
    })
    messages = trimmed.messages
    estimatedTokens = trimmed.estimatedTokens
    tokensBeforeTrim = trimmed.tokensBeforeTrim
    droppedLoreCount = trimmed.drops.droppedLoreCount
    droppedMemoryCount = trimmed.drops.droppedMemoryCount
    droppedKnowledgeCount = trimmed.drops.droppedKnowledgeCount
    droppedHistoryCount = resolveHistoryTrimAudit(
      historyOrdinalsBeforeTrim,
      trimState.historyMessages,
    ).droppedCount
  }
  const afterBudgetTrimAt = auditEnabled ? performance.now() : 0

  if (macroContext) {
    await persistMacroVarMutations(macroContext)
  }
  const finalMessages = compactEmptyMessages(messages)
  const finalEstimatedTokens =
    finalMessages.length === messages.length &&
    finalMessages.every((m, i) => m.content === messages[i]?.content)
      ? estimatedTokens
      : countChatMessagesTokens(finalMessages, { model: tokenModel })

  const finalMemoryText = memoryTextFromTrimState(trimState)

  let assemblyAudit: AssemblyAudit | undefined
  let assemblyEmbeddingCalls: CallAuditEntry[] | undefined
  let performanceAudit: PerformanceAudit | undefined

  if (auditEnabled) {
    assemblyAudit = buildAssemblyAudit({
      estimatedTokens: finalEstimatedTokens,
      tokenModel,
      maxTokens,
      trimMaxTokens: trimMaxTokensForAudit,
      tokensBeforeTrim,
      lorebookIds,
      lorebookNameToId,
      knowledgeBaseIds: kbIds,
      knowledgeEnabled: effectiveKnowledge.enabled,
      initialKnowledgeItems,
      droppedKnowledgeCount,
      memoryPipeline,
      loreParts,
      initialMatchedLore,
      initialMemoryItems,
      trimState,
      historyTurnOrdinalsBeforeTrim: historyOrdinalsBeforeTrim,
      droppedLoreCount,
      droppedMemoryCount,
      memoryEnabled: effectiveMemory.memoryEnabled,
      pluginAdditionCache: pluginCache,
    })

    assemblyEmbeddingCalls = []
    if (memoryPipeline.embeddingCall) {
      assemblyEmbeddingCalls.push({
        kind: 'embedding',
        purpose: 'memory_recall',
        model: memoryPipeline.embeddingCall.model,
        latencyMs: memoryPipeline.embeddingCall.latencyMs,
      })
    }

    const round = (n: number) => Math.round(n)
    const assemblyMs: AssemblyTimingMs = {
      total: round(afterBudgetTrimAt - assemblyStartedAt),
      memory: round(afterMemoryAt - assemblyStartedAt),
      characters: round(afterCharactersAt - afterMemoryAt),
      lore: round(afterLoreAt - afterCharactersAt),
      assembleAndTrim: round(afterBudgetTrimAt - afterLoreAt),
      knowledge: round(afterKnowledgeAt - afterLoreAt),
      pluginReserve: 0,
      budgetTrim: round(afterBudgetTrimAt - afterRegexAt),
      budgetTrimAssemblePasses,
      macros: round(afterMacrosAt - afterPluginsAt),
      regexOutgoing: round(afterRegexAt - afterMacrosAt),
      pluginsAfterAssemble: round(afterPluginsAt - afterBaseAssembleAt),
    }
    performanceAudit = { assemblyMs }
  }

  return {
    messages: finalMessages,
    estimatedTokens: finalEstimatedTokens,
    droppedLoreCount,
    droppedHistoryCount,
    droppedMemoryCount,
    droppedKnowledgeCount,
    memoryTurnIds: trimState.memoryItems.map((x) => x.turn.turnId),
    memoryText: finalMemoryText || undefined,
    speakerCharacterId,
    ...(assemblyAudit ? { assemblyAudit } : {}),
    ...(assemblyEmbeddingCalls ? { assemblyEmbeddingCalls } : {}),
    ...(performanceAudit ? { performanceAudit } : {}),
    ...(resolvedRagGenerate ? { resolvedRagGenerate } : {}),
  }
}
