import { ApiErrorCodes } from './api-error-codes.js'
import { isMemoryVectorIndexCorruptError } from './memory-vector-index-error.js'
import {
  assemblePrompts,
  type BoundCharacterSlice,
  type ChatMessage,
  type PromptPreset,
  type PromptTrigger,
} from './assemble-prompts.js'
import { buildPromptMacroContext } from './prompt-macros/index.js'
import { patchPromptMacroHistoryFields } from './prompt-macros/context.js'
import { buildMacroHistoryFields } from './prompt-macros/history-macros.js'
import { extractMacroCharacterFields } from './prompt-macros/index.js'
import { applyMacrosToMessages } from './prompt-macros/index.js'
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
  type ConversationIndex,
} from './chat-storage.js'
import { readCharacterDocument } from './character-storage.js'
import type { PromptsDocument } from './prompts-file.js'
import { resolveLorebookSettings } from './lorebook-settings.js'
import { resolveLorebookInjectionParts } from './lorebook-resolve.js'
import { readLorebooksByIds } from './lorebook-file.js'
import { buildAssemblyAudit } from './build-assembly-audit.js'
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
  readGlobalLorebookSettings,
  readGlobalMemorySettings,
} from './user-preferences-file.js'
import { resolveBudgetTrimSettings } from './budget-trim-settings.js'
import { normalizePresetForAssemble } from './prompt-preset-normalize.js'
import { readApiSettingsFromFile } from './api-settings-file.js'
import {
  mergePresetWithChatBinding,
  readConversationChatBinding,
} from './conversation-api-settings.js'
import {
  resolveFeatureApi,
  resolveChatApiConfigId,
  toResolvedFeatureAudit,
  type ResolvedFeatureAudit,
} from './feature-binding-resolve.js'
import { applyPluginsAfterAssemblePrompts } from './plugin-host.js'
import type { ChatPluginsBody } from './plugin-types.js'
import { countChatMessagesTokens } from './token-count.js'
import { readTurnsInOrdinalRange } from './chunk-chain.js'
import { loadTurnsForMacroIndexing } from './prompt-macros/macro-indexing-turns.js'
import { readPluginRegistry } from './plugin-system/registry.js'
import type { TurnRecord } from './chat-storage.js'
import {
  memoryTextFromTrimState,
  runPromptBudgetTrimLoop,
  type PromptBudgetTrimState,
  worldTextFromTrimState,
} from './prompt-budget-trim.js'
import {
  loadAndApplyRegexOutgoing,
  resolveOutgoingTailOrdinal,
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

function resolveMaxResponseTokensForConversation(
  idx: ConversationIndex,
  apiSettings: NonNullable<Awaited<ReturnType<typeof readApiSettingsFromFile>>>,
): number | undefined {
  const binding = readConversationChatBinding(idx.apiPreset)
  const resolved = resolveChatApiConfigId(apiSettings, idx.apiPreset)
  const presetId = (
    binding?.apiConfigId?.trim() ||
    resolved?.apiConfigId ||
    apiSettings.activePresetId ||
    ''
  ).trim()
  if (!presetId) return undefined
  const preset = apiSettings.presets.find((p) => p.id === presetId)
  if (!preset) return undefined
  const merged = mergePresetWithChatBinding(preset, binding)
  const n = merged.maxTokens
  if (typeof n === 'number' && !Number.isNaN(n) && n > 0) {
    return Math.floor(n)
  }
  return undefined
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
  /** debug 审计：组装命中明细（由调用方决定是否落盘） */
  assemblyAudit?: AssemblyAudit
  /** debug 审计：本轮组装阶段的 embedding 调用 */
  assemblyEmbeddingCalls?: CallAuditEntry[]
  /** debug 审计：组装阶段耗时 */
  performanceAudit?: PerformanceAudit
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

  const auditEnabled = isAuditDebugWriteEnabled(idx)
  const assemblyStartedAt = auditEnabled ? performance.now() : 0

  let memoryPipeline
  let indexingTurns: TurnRecord[] = []
  let enabledPluginIds: string[] = []
  try {
    const beforeEx = params.historyBeforeTurnOrdinalExclusive ?? undefined
    ;[memoryPipeline, indexingTurns, enabledPluginIds] = await Promise.all([
      runMemoryPipeline({
        conversationId,
        userText: userInput,
        memorySettings: effectiveMemory,
        historySettings: effectiveHistory,
        historyBeforeTurnOrdinalExclusive: beforeEx,
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

  const charIds = resolvedCharacterIds(idx)
  const [userCharacter, characters] = await Promise.all([
    loadUserCharacterSlice(idx),
    loadBoundCharacterSlices(charIds),
  ])
  const afterCharactersAt = auditEnabled ? performance.now() : 0

  const charCtx: {
    userCharacter?: BoundCharacterSlice
    characters?: BoundCharacterSlice[]
  } = {}
  if (userCharacter) charCtx.userCharacter = userCharacter
  if (characters.length > 0) charCtx.characters = characters

  const trigger = normalizeTrigger(params.promptTrigger)

  const globalDefaultAuthorsNote = await readGlobalDefaultAuthorsNote()

  const activeTurn = await loadActiveTurnForMacro(
    conversationId,
    params.historyBeforeTurnOrdinalExclusive,
    trigger,
  )

  const charNameList = characters
    .map((c) => c.name?.trim())
    .filter((n): n is string => Boolean(n))

  const historyFields = buildMacroHistoryFields({
    indexingTurns,
    historyTurns: memoryPipeline.recentTurns,
    activeTurn,
    characterNames: charNameList,
  })

  let macroContext = buildPromptMacroContext({
    conversationUserName: idx.userName,
    characters,
    userCharacter,
    model: params.tokenModel ?? undefined,
    contextLength: maxTokens,
    maxResponseTokens: apiSettings
      ? resolveMaxResponseTokensForConversation(idx, apiSettings)
      : undefined,
    userInput,
    promptTrigger: trigger,
    authorsNote: authorsNoteMacroText(idx.authorsNote),
    defaultAuthorsNote: defaultAuthorsNoteMacroText(globalDefaultAuthorsNote),
    conversationId,
    historyFields,
    enabledPluginIds,
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
      : { constantLoreGroups: [], matchedLore: [] }
  const afterLoreAt = auditEnabled ? performance.now() : 0

  const initialMatchedLore = loreParts.matchedLore.slice()
  const initialMemoryItems = memoryPipeline.memoryItems.slice()

  const tokenModel =
    typeof params.tokenModel === 'string' && params.tokenModel.trim().length > 0
      ? params.tokenModel.trim()
      : undefined

  const trimState: PromptBudgetTrimState = {
    constantLoreGroups: loreParts.constantLoreGroups,
    matchedLore: loreParts.matchedLore.slice(),
    memoryItems: memoryPipeline.memoryItems.slice(),
    historyMessages: memoryPipeline.recentHistoryMessages.map((m) => ({ ...m })),
  }

  const assembleCtxBase = {
    trigger,
    userInput,
    tokenModel,
    macroContext,
    authorsNote: authorsNote ?? undefined,
    skipInternalBudgetTrim: true as const,
    deferMacroExpansion: true as const,
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

  macroContext = patchPromptMacroHistoryFields(
    macroContext,
    buildMacroHistoryFields({
      indexingTurns,
      historyTurns: memoryPipeline.recentTurns,
      activeTurn,
      trimmedHistoryMessages: trimState.historyMessages,
      characterNames: charNameList,
    }),
  )
  applyMacrosToMessages(messages, macroContext)

  const afterAssembleAt = auditEnabled ? performance.now() : 0

  const tailOrdinal = resolveOutgoingTailOrdinal({
    sourceHistoryTurnOrdinals: memoryPipeline.recentHistoryTurnOrdinals,
    historyBeforeTurnOrdinalExclusive: params.historyBeforeTurnOrdinalExclusive,
  })
  messages = await loadAndApplyRegexOutgoing(messages, {
    tailOrdinal,
    sourceHistoryMessages: memoryPipeline.recentHistoryMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    sourceHistoryTurnOrdinals: memoryPipeline.recentHistoryTurnOrdinals,
    trimmedHistoryMessages: trimState.historyMessages,
    memoryItems: trimState.memoryItems,
    userInput: userInput,
    macroContext,
  })
  const afterRegexAt = auditEnabled ? performance.now() : 0

  estimatedTokens = countChatMessagesTokens(messages, { model: tokenModel })

  const messagesAfterPlugins = await applyPluginsAfterAssemblePrompts({
    messages,
    macroContext,
    plugins: params.plugins,
  })
  if (macroContext) {
    applyMacrosToMessages(messagesAfterPlugins, macroContext, {
      onlyIfNeeded: true,
    })
  }
  const finalEstimatedTokens =
    messagesAfterPlugins.length === messages.length
      ? estimatedTokens
      : countChatMessagesTokens(messagesAfterPlugins, { model: tokenModel })

  const finalMemoryText = memoryTextFromTrimState(trimState)
  const afterPluginsAt = auditEnabled ? performance.now() : 0

  let assemblyAudit: AssemblyAudit | undefined
  let assemblyEmbeddingCalls: CallAuditEntry[] | undefined
  let performanceAudit: PerformanceAudit | undefined

  if (auditEnabled) {
    assemblyAudit = buildAssemblyAudit({
      estimatedTokens: finalEstimatedTokens,
      tokenModel,
      maxTokens,
      lorebookIds,
      lorebookNameToId,
      memoryPipeline,
      loreParts,
      initialMatchedLore,
      initialMemoryItems,
      trimState,
      droppedLoreCount,
      droppedMemoryCount,
      droppedHistoryCount,
      memoryEnabled: effectiveMemory.memoryEnabled,
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
      total: round(afterPluginsAt - assemblyStartedAt),
      memory: round(afterMemoryAt - assemblyStartedAt),
      characters: round(afterCharactersAt - afterMemoryAt),
      lore: round(afterLoreAt - afterCharactersAt),
      assembleAndTrim: round(afterAssembleAt - afterLoreAt),
      regexOutgoing: round(afterRegexAt - afterAssembleAt),
      pluginsAfterAssemble: round(afterPluginsAt - afterRegexAt),
    }
    performanceAudit = { assemblyMs }
  }

  return {
    messages: messagesAfterPlugins,
    estimatedTokens: finalEstimatedTokens,
    droppedLoreCount,
    droppedHistoryCount,
    droppedMemoryCount,
    memoryTurnIds: trimState.memoryItems.map((x) => x.turn.turnId),
    memoryText: finalMemoryText || undefined,
    ...(assemblyAudit ? { assemblyAudit } : {}),
    ...(assemblyEmbeddingCalls ? { assemblyEmbeddingCalls } : {}),
    ...(performanceAudit ? { performanceAudit } : {}),
    ...(resolvedRagGenerate ? { resolvedRagGenerate } : {}),
  }
}
