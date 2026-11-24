/**
 * 核心检索 tools：薄封装 lore / memory / knowledge（与主 assemble 窗口对齐）。
 * OpenAI function.name 禁止点号。topK 沿用会话/全局设置。
 */

import { buildAllowedBranchPathsForActive } from '../chunk-path.js'
import { readConversationIndex, resolvedLorebookIds } from '../chat-storage.js'
import { resolveEmbeddingApiCredentials } from '../embedding-credential-resolve.js'
import { embeddingIndexMatchesProvider } from '../embedding-profile.js'
import { resolveHistorySettings } from '../history-settings.js'
import {
  resolveEffectiveHybridFtsSettings,
  parseHybridFtsSettingsStrict,
  hybridFtsSpecsMatch,
} from '../hybrid-fts-settings.js'
import { recallKnowledgeForConversation } from '../knowledge-resolve.js'
import {
  resolveKnowledgeSettings,
  normalizeKnowledgeSettings,
} from '../knowledge-settings.js'
import { buildScanText } from '../lore-scan.js'
import { resolveLorebookInjectionParts } from '../lorebook-resolve.js'
import { resolveLorebookSettings } from '../lorebook-settings.js'
import {
  resolveMemorySettings,
  normalizeMemorySettings,
} from '../memory-settings.js'
import {
  lastAssistantBeforeExclusive,
  loadTurnsForMemoryPipeline,
  resolveHistoryXmlTurnCount,
  selectRecentTurns,
} from '../memory-pipeline.js'
import { searchTurnMemoryVectors } from '../memory-store.js'
import { loadTurnsForMemoryHits } from '../memory-hits.js'
import {
  buildMemoryRecallVectors,
  resolveMemoryCorpusOptions,
} from '../memory-corpus.js'
import { worldTextFromTrimState } from '../prompt-budget-trim.js'
import { clampAgentToolResult } from './agent-limits.js'
import {
  applyOutgoingRegexToMemoryItems,
  resolveOutgoingTailOrdinal,
} from '../regex-outgoing.js'
import { readRegexRulesDocument } from '../regex-rules-file.js'
import {
  formatMemoryXml,
  memoryItemsToScanPlainText,
  turnsToHistoryScanPlainText,
} from '../turn-memory-xml.js'
import {
  readGlobalHistorySettings,
  readGlobalHybridFtsSettings,
  readGlobalKnowledgeSettings,
  readGlobalLorebookSettings,
  readGlobalMemorySettings,
} from '../user-preferences-file.js'
import type { AgentToolDefinition } from './types.js'

export const CORE_LORE_SEARCH_TOOL = 'lore_search'
export const CORE_MEMORY_SEARCH_TOOL = 'memory_search'
export const CORE_KNOWLEDGE_SEARCH_TOOL = 'knowledge_search'

/** 与 assemble 一致的 history / 分支窗口（再生、群聊续写） */
export type AgentSearchContext = {
  historyBeforeTurnOrdinalExclusive?: number | null
  historyPartialTurn?: {
    turnOrdinal: number
    segmentIndexExclusive: number
  }
  activeBranchPath?: string | null
}

const QUERY_ONLY_PARAMS = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query text' },
  },
  required: ['query'],
  additionalProperties: false,
} as const

export const coreLoreSearchDefinition: AgentToolDefinition = {
  type: 'function',
  function: {
    name: CORE_LORE_SEARCH_TOOL,
    description:
      'Resolve bound lorebooks like main chat: constant entries always; keyword vs vector by entry triggerMode and lore settings; scan = query + memoryScan + recent history.',
    parameters: { ...QUERY_ONLY_PARAMS },
  },
}

export const coreMemorySearchDefinition: AgentToolDefinition = {
  type: 'function',
  function: {
    name: CORE_MEMORY_SEARCH_TOOL,
    description:
      'Search turn memory (vector/hybrid). Excludes recent history window. Uses memoryTopK; applies outgoing regex like main-chat memory injection.',
    parameters: { ...QUERY_ONLY_PARAMS },
  },
}

export const coreKnowledgeSearchDefinition: AgentToolDefinition = {
  type: 'function',
  function: {
    name: CORE_KNOWLEDGE_SEARCH_TOOL,
    description:
      'Search bound knowledge bases. Query uses scan corpus (query + history) like main chat; topK from knowledge settings.',
    parameters: { ...QUERY_ONLY_PARAMS },
  },
}

export function listCoreAgentToolDefinitions(): AgentToolDefinition[] {
  return [
    coreLoreSearchDefinition,
    coreMemorySearchDefinition,
    coreKnowledgeSearchDefinition,
  ]
}

export function isCoreAgentToolName(name: string): boolean {
  const n = name.trim()
  return (
    n === CORE_LORE_SEARCH_TOOL ||
    n === CORE_MEMORY_SEARCH_TOOL ||
    n === CORE_KNOWLEDGE_SEARCH_TOOL
  )
}

export async function resolveRequiredCoreSearchToolNames(
  conversationId: string,
): Promise<string[]> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return []
  const out: string[] = []
  if (resolvedLorebookIds(idx).length > 0) out.push(CORE_LORE_SEARCH_TOOL)
  const globalMemory = await readGlobalMemorySettings()
  const memorySettings = resolveMemorySettings(
    normalizeMemorySettings(globalMemory),
    idx.memorySettings,
  )
  if (memorySettings.memoryEnabled) out.push(CORE_MEMORY_SEARCH_TOOL)
  const kbIds = Array.isArray(idx.knowledgeBaseIds) ? idx.knowledgeBaseIds : []
  if (kbIds.length > 0) out.push(CORE_KNOWLEDGE_SEARCH_TOOL)
  return out
}

function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const v = JSON.parse(argsJson) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
  } catch {
    /* ignore */
  }
  return {}
}

function truncate(s: string): string {
  return clampAgentToolResult(s)
}

async function resolveWindow(conversationId: string, ctx?: AgentSearchContext) {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const globalMemory = await readGlobalMemorySettings()
  const memorySettings = resolveMemorySettings(
    normalizeMemorySettings(globalMemory),
    idx.memorySettings,
  )
  const corpusOptions = await resolveMemoryCorpusOptions(memorySettings)
  const globalHistory = await readGlobalHistorySettings()
  const historySettings = resolveHistorySettings(
    globalHistory,
    idx.historySettings,
  )
  const historyCount = resolveHistoryXmlTurnCount(historySettings)
  const beforeExclusive = ctx?.historyBeforeTurnOrdinalExclusive ?? null
  const activeBranchPath =
    ctx?.activeBranchPath ??
    (typeof idx.activeBranchPath === 'string' ? idx.activeBranchPath : '')
  const pipelineTurns = await loadTurnsForMemoryPipeline(
    conversationId,
    historyCount,
    beforeExclusive,
    activeBranchPath,
  )
  const recentTurns = selectRecentTurns(
    pipelineTurns,
    historyCount,
    beforeExclusive,
  )
  const recentTurnIds = new Set(recentTurns.map((t) => t.turnId))
  const recentHistoryScanText = turnsToHistoryScanPlainText(
    recentTurns,
    corpusOptions,
    { partialTurn: ctx?.historyPartialTurn },
  )
  const globalHybrid = await readGlobalHybridFtsSettings()
  const hybridFts = resolveEffectiveHybridFtsSettings(
    globalHybrid,
    parseHybridFtsSettingsStrict(idx.memoryHybridFts),
  )
  return {
    idx,
    memorySettings,
    corpusOptions,
    historySettings,
    hybridFts,
    pipelineTurns,
    recentTurns,
    recentTurnIds,
    recentHistoryScanText,
    beforeExclusive,
    activeBranchPath,
    historyPartialTurn: ctx?.historyPartialTurn,
  }
}

async function recallMemoryItemsForAgent(
  conversationId: string,
  query: string,
  win: NonNullable<Awaited<ReturnType<typeof resolveWindow>>>,
): Promise<{
  items: { turn: import('../chat-turn-types.js').TurnRecord; score: number }[]
  note?: string
}> {
  if (!win.memorySettings.memoryEnabled) {
    return { items: [], note: 'memory_disabled' }
  }
  const provider = await resolveEmbeddingApiCredentials(conversationId)
  const profileOk = embeddingIndexMatchesProvider(
    {
      embeddingProfile: win.idx.memoryEmbeddingProfile,
      embeddingModel: win.idx.memoryEmbeddingModel,
      embeddingDimensions: win.idx.memoryEmbeddingDimensions,
    },
    provider,
  )
  const hybridOk = hybridFtsSpecsMatch(
    win.idx.memoryHybridFtsProfile,
    win.hybridFts,
  )
  if (!profileOk || !hybridOk) {
    return { items: [], note: 'memory_index_stale' }
  }
  const lastAssistant = lastAssistantBeforeExclusive(
    win.pipelineTurns,
    win.beforeExclusive,
  )
  const recall = await buildMemoryRecallVectors(conversationId, {
    userText: query,
    lastAssistantRaw: lastAssistant,
    memorySettings: win.memorySettings,
    corpusOptions: win.corpusOptions,
  })
  if (!recall) return { items: [], note: 'no_recall_vector' }
  const minRecentOrdinal =
    win.recentTurns.length > 0
      ? Math.min(...win.recentTurns.map((t) => t.turnOrdinal))
      : undefined
  const hits = await searchTurnMemoryVectors(
    conversationId,
    recall.vector,
    recall.ftsQueryText,
    win.hybridFts,
    win.memorySettings.memoryTopK,
    win.recentTurnIds,
    minRecentOrdinal,
    buildAllowedBranchPathsForActive(win.activeBranchPath),
  )
  const items = await loadTurnsForMemoryHits(
    conversationId,
    hits,
    win.recentTurnIds,
  )
  return { items }
}

export async function runCoreLoreSearchTool(
  conversationId: string,
  argsJson: string,
  ctx?: AgentSearchContext,
): Promise<string> {
  const args = parseArgs(argsJson)
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) {
    return JSON.stringify({ ok: false, code: 'missing_query' })
  }
  const win = await resolveWindow(conversationId, ctx)
  if (!win) {
    return JSON.stringify({ ok: false, code: 'conversation_not_found' })
  }
  const lorebookIds = resolvedLorebookIds(win.idx)
  if (!lorebookIds.length) {
    return JSON.stringify({
      ok: true,
      hits: 0,
      text: '',
      note: 'no_lorebooks',
    })
  }
  const globalLore = await readGlobalLorebookSettings()
  const loreSettings = resolveLorebookSettings(
    globalLore,
    win.idx.lorebookSettings,
  )

  // memoryScan：与主路径一致；嵌入失败时降级为空扫描，不拖垮整个 lore_search
  let memoryScanText = ''
  if (win.memorySettings.memoryEnabled) {
    try {
      const mem = await recallMemoryItemsForAgent(conversationId, query, win)
      memoryScanText = memoryItemsToScanPlainText(mem.items, win.corpusOptions)
    } catch {
      memoryScanText = ''
    }
  }
  const scanCorpus = buildScanText(
    query,
    memoryScanText,
    win.recentHistoryScanText,
  )

  const parts = await resolveLorebookInjectionParts(lorebookIds, {
    scanCorpus,
    conversationId,
    lorebookSettings: loreSettings,
  })
  const keywordMatched = parts.matchedLore.filter((m) => m.mode === 'keyword')
  const vectorMatched = parts.matchedLore.filter((m) => m.mode === 'vector')
  const loreText = (
    constantLore: typeof parts.constantLore,
    matchedLore: typeof parts.matchedLore,
  ) =>
    worldTextFromTrimState({
      constantLore,
      matchedLore,
      memoryItems: [],
      knowledgeItems: [],
      historyMessages: [],
    })
  const sections: string[] = []
  const constantText = loreText(parts.constantLore, [])
  const keywordText = loreText([], keywordMatched)
  const vectorText = loreText([], vectorMatched)
  if (constantText.trim()) {
    sections.push(`### lore · constant\n${constantText.trim()}`)
  }
  if (keywordText.trim()) {
    sections.push(`### lore · keyword\n${keywordText.trim()}`)
  }
  if (vectorText.trim()) {
    sections.push(`### lore · vector\n${vectorText.trim()}`)
  }
  return JSON.stringify({
    ok: true,
    hits: parts.constantLore.length + parts.matchedLore.length,
    settings: {
      vectorEnabled: loreSettings.vectorEnabled,
      keywordTopK: loreSettings.keywordTopK,
      vectorTopK: loreSettings.vectorTopK,
      recursiveEnabled: loreSettings.recursiveEnabled,
    },
    constant: { count: parts.constantLore.length },
    keyword: { count: keywordMatched.length },
    vector: {
      count: vectorMatched.length,
      note: loreSettings.vectorEnabled ? undefined : 'vectorEnabled=false',
    },
    scanCorpusChars: scanCorpus.length,
    text: truncate(sections.join('\n\n')),
  })
}

export async function runCoreMemorySearchTool(
  conversationId: string,
  argsJson: string,
  ctx?: AgentSearchContext,
): Promise<string> {
  const args = parseArgs(argsJson)
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) {
    return JSON.stringify({ ok: false, code: 'missing_query' })
  }
  const win = await resolveWindow(conversationId, ctx)
  if (!win) {
    return JSON.stringify({ ok: false, code: 'conversation_not_found' })
  }
  let mem: Awaited<ReturnType<typeof recallMemoryItemsForAgent>>
  try {
    mem = await recallMemoryItemsForAgent(conversationId, query, win)
  } catch (e) {
    // 抛给 runCoreAgentTool → tool_failed（ok:false），不计入成功预算，可重试
    throw e instanceof Error
      ? e
      : new Error(typeof e === 'string' ? e : 'memory_recall_failed')
  }
  if (mem.note && mem.items.length === 0) {
    return JSON.stringify({
      ok: true,
      hits: 0,
      text: '',
      note: mem.note,
      excludedRecentTurns: win.recentTurnIds.size,
    })
  }
  const tailOrdinal = resolveOutgoingTailOrdinal({
    sourceHistoryTurnOrdinals: win.recentTurns.map((t) => t.turnOrdinal),
    historyBeforeTurnOrdinalExclusive: win.beforeExclusive,
  })
  const regexDoc = await readRegexRulesDocument()
  const processedItems = applyOutgoingRegexToMemoryItems(
    mem.items,
    regexDoc.rules,
    tailOrdinal,
  )
  return JSON.stringify({
    ok: true,
    hits: processedItems.length,
    topK: win.memorySettings.memoryTopK,
    excludedRecentTurns: win.recentTurnIds.size,
    text: truncate(formatMemoryXml(processedItems)),
  })
}

export async function runCoreKnowledgeSearchTool(
  conversationId: string,
  argsJson: string,
  ctx?: AgentSearchContext,
): Promise<string> {
  const args = parseArgs(argsJson)
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) {
    return JSON.stringify({ ok: false, code: 'missing_query' })
  }
  const win = await resolveWindow(conversationId, ctx)
  if (!win) {
    return JSON.stringify({ ok: false, code: 'conversation_not_found' })
  }
  const kbIds = Array.isArray(win.idx.knowledgeBaseIds)
    ? win.idx.knowledgeBaseIds
    : []
  if (!kbIds.length) {
    return JSON.stringify({
      ok: true,
      hits: 0,
      text: '',
      note: 'no_knowledge_bases',
    })
  }
  let memoryScanText = ''
  if (win.memorySettings.memoryEnabled) {
    try {
      const mem = await recallMemoryItemsForAgent(conversationId, query, win)
      memoryScanText = memoryItemsToScanPlainText(mem.items, win.corpusOptions)
    } catch {
      memoryScanText = ''
    }
  }
  const scanCorpus = buildScanText(
    query,
    memoryScanText,
    win.recentHistoryScanText,
  )
  const globalKnowledge = await readGlobalKnowledgeSettings()
  const knowledgeSettings = resolveKnowledgeSettings(
    normalizeKnowledgeSettings(globalKnowledge),
    win.idx.knowledgeSettings,
  )
  const topK = knowledgeSettings.topK
  const recalled = await recallKnowledgeForConversation({
    knowledgeBaseIds: kbIds,
    queryText: scanCorpus || query,
    conversationId,
    knowledgeSettings: win.idx.knowledgeSettings,
    topK,
  })
  return JSON.stringify({
    ok: true,
    hits: recalled.items.length,
    topK,
    scanCorpusChars: scanCorpus.length,
    text: truncate(recalled.knowledgeText || ''),
  })
}

export async function runCoreAgentTool(
  name: string,
  conversationId: string,
  argsJson: string,
  ctx?: AgentSearchContext,
): Promise<{ ok: true; content: string } | { ok: false; code: string; detail?: string }> {
  try {
    if (name === CORE_LORE_SEARCH_TOOL) {
      return {
        ok: true,
        content: await runCoreLoreSearchTool(conversationId, argsJson, ctx),
      }
    }
    if (name === CORE_MEMORY_SEARCH_TOOL) {
      return {
        ok: true,
        content: await runCoreMemorySearchTool(conversationId, argsJson, ctx),
      }
    }
    if (name === CORE_KNOWLEDGE_SEARCH_TOOL) {
      return {
        ok: true,
        content: await runCoreKnowledgeSearchTool(
          conversationId,
          argsJson,
          ctx,
        ),
      }
    }
    return { ok: false, code: 'tool_not_found', detail: name }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { ok: false, code: 'tool_failed', detail: detail.slice(0, 500) }
  }
}
