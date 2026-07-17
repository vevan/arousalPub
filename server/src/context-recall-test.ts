import { buildAllowedBranchPathsForActive } from './chunk-path.js'
import {
  resolvedLorebookIds,
  type ConversationIndex,
} from './chat-storage.js'
import { resolveHistorySettings } from './history-settings.js'
import { loadTurnsForMemoryHits } from './memory-hits.js'
import {
  lastAssistantBeforeExclusive,
  loadTurnsForMemoryPipeline,
  resolveHistoryXmlTurnCount,
  runMemoryPipeline,
} from './memory-pipeline.js'
import { searchTurnMemoryVectors } from './memory-store.js'
import { readLorebooksByIds } from './lorebook-file.js'
import { resolveLorebookInjectionParts } from './lorebook-resolve.js'
import type { Lorebook } from './lorebook-types.js'
import { buildScanText } from './lore-scan.js'
import { resolveLorebookSettings } from './lorebook-settings.js'
import {
  buildMemoryEmbeddingCorpus,
  buildMemoryRecallVectors,
  resolveMemoryCorpusOptions,
} from './memory-corpus.js'
import { resolveMemorySettings } from './memory-settings.js'
import { recallKnowledgeForConversation } from './knowledge-resolve.js'
import {
  readGlobalHistorySettings,
  readGlobalLorebookSettings,
  readGlobalMemorySettings,
} from './user-preferences-file.js'

const PREVIEW_MAX_LEN = 240
const TOP_K_MIN = 1
const TOP_K_MAX = 64

export interface ContextRecallTestRequest {
  query: string
  topK: number
  /** 模拟该轮发送前语料：等同组装的 historyBeforeTurnOrdinalExclusive */
  simulateTurnOrdinal?: number
}

export interface ContextRecallMemoryHit {
  turnId: string
  turnOrdinal: number
  score: number
  preview: string
  content: string
}

export interface ContextRecallLoreHit {
  lorebookId: string
  lorebookName: string
  entryId: string
  title: string
  mode: 'keyword' | 'vector' | 'constant'
  score?: number
  scoreKind?: 'rrf' | 'vector_fallback'
  preview: string
  content: string
}

export interface ContextRecallKnowledgeHit {
  kbId: string
  kbName: string
  fileId: string
  fileName: string
  chunkId: string
  ordinal: number
  score: number
  preview: string
  content: string
}

export interface ContextRecallTestResult {
  query: string
  topK: number
  simulateTurnOrdinal?: number
  loreScanCorpusChars: number
  memory: {
    hits: ContextRecallMemoryHit[]
    embeddingError?: string
  }
  lore: {
    lorebookIds: string[]
    hits: ContextRecallLoreHit[]
  }
  knowledge: {
    knowledgeBaseIds: string[]
    hits: ContextRecallKnowledgeHit[]
  }
}

export function parseContextRecallTestBody(
  raw: unknown,
):
  | { ok: true; request: ContextRecallTestRequest }
  | {
      ok: false
      error:
        | 'context_recall_query_required'
        | 'context_recall_topk_invalid'
        | 'context_recall_simulate_turn_invalid'
    } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'context_recall_query_required' }
  }
  const b = raw as Record<string, unknown>
  const query = typeof b.query === 'string' ? b.query.trim() : ''
  if (!query) {
    return { ok: false, error: 'context_recall_query_required' }
  }
  let topK = typeof b.topK === 'number' ? Math.trunc(b.topK) : 10
  if (Number.isNaN(topK)) topK = 10
  if (topK < TOP_K_MIN || topK > TOP_K_MAX) {
    return { ok: false, error: 'context_recall_topk_invalid' }
  }
  let simulateTurnOrdinal: number | undefined
  const simRaw =
    b.simulateTurnOrdinal ?? b.alignTurnOrdinal
  if (Object.prototype.hasOwnProperty.call(b, 'simulateTurnOrdinal') ||
    Object.prototype.hasOwnProperty.call(b, 'alignTurnOrdinal')) {
    if (typeof simRaw !== 'number' || !Number.isInteger(simRaw) || simRaw < 0) {
      return { ok: false, error: 'context_recall_simulate_turn_invalid' }
    }
    simulateTurnOrdinal = simRaw
  }
  return {
    ok: true,
    request: {
      query,
      topK,
      ...(simulateTurnOrdinal != null ? { simulateTurnOrdinal } : {}),
    },
  }
}

function previewText(text: string): string {
  const t = text.trim()
  if (t.length <= PREVIEW_MAX_LEN) return t
  return `${t.slice(0, PREVIEW_MAX_LEN)}…`
}

function lorebookNameMap(
  lorebookIds: string[],
  byId: Map<string, Lorebook>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const id of lorebookIds) {
    const lb = byId.get(id)
    const name = lb?.name.trim() || id
    out.set(name, id)
    out.set(id, id)
  }
  return out
}

export async function runContextRecallTest(
  conversationId: string,
  request: ContextRecallTestRequest,
  idx: ConversationIndex,
): Promise<ContextRecallTestResult> {
  const { query, topK, simulateTurnOrdinal } = request
  const lorebookIds = resolvedLorebookIds(idx)
  const knowledgeBaseIds = Array.isArray(idx.knowledgeBaseIds)
    ? idx.knowledgeBaseIds.filter((id) => typeof id === 'string' && id.trim())
    : []
  const activeBranchPath = idx.activeBranchPath ?? ''

  const globalMemory = await readGlobalMemorySettings()
  const effectiveMemory = resolveMemorySettings(globalMemory, idx.memorySettings)
  const corpusOptions = await resolveMemoryCorpusOptions(effectiveMemory)

  const globalHist = await readGlobalHistorySettings()
  const effectiveHist = resolveHistorySettings(globalHist, idx.historySettings)
  const historyCount = resolveHistoryXmlTurnCount(effectiveHist)

  const memoryPipeline = await runMemoryPipeline({
    conversationId,
    userText: query,
    memorySettings: effectiveMemory,
    historySettings: effectiveHist,
    historyBeforeTurnOrdinalExclusive: simulateTurnOrdinal,
    activeBranchPath,
  })

  const memoryHits: ContextRecallMemoryHit[] = []
  let embeddingError: string | undefined

  const pipelineTurns = await loadTurnsForMemoryPipeline(
    conversationId,
    historyCount,
    simulateTurnOrdinal,
    activeBranchPath,
  )
  const lastAssistant = lastAssistantBeforeExclusive(
    pipelineTurns,
    simulateTurnOrdinal,
  )

  const recall = await buildMemoryRecallVectors(conversationId, {
    userText: query,
    lastAssistantRaw: lastAssistant,
    memorySettings: effectiveMemory,
    corpusOptions,
  })

  if (!recall) {
    embeddingError = 'embedding_unavailable'
  } else {
    const recentTurnIds = new Set(
      simulateTurnOrdinal != null
        ? memoryPipeline.recentTurns.map((t) => t.turnId)
        : [],
    )
    const minRecentOrdinal =
      simulateTurnOrdinal != null && memoryPipeline.recentTurns.length > 0
        ? Math.min(...memoryPipeline.recentTurns.map((t) => t.turnOrdinal))
        : simulateTurnOrdinal

    const rawHits = await searchTurnMemoryVectors(
      conversationId,
      recall.vector,
      recall.ftsQueryText,
      topK,
      recentTurnIds,
      minRecentOrdinal,
      buildAllowedBranchPathsForActive(activeBranchPath),
    )
    const items = await loadTurnsForMemoryHits(conversationId, rawHits, recentTurnIds)
    for (const { turn, score } of items) {
      if (
        simulateTurnOrdinal != null &&
        turn.turnOrdinal >= simulateTurnOrdinal
      ) {
        continue
      }
      const content = buildMemoryEmbeddingCorpus(turn, corpusOptions)
      memoryHits.push({
        turnId: turn.turnId,
        turnOrdinal: turn.turnOrdinal,
        score,
        preview: previewText(content),
        content,
      })
      if (memoryHits.length >= topK) break
    }
  }

  const globalLore = await readGlobalLorebookSettings()
  const effectiveLore = resolveLorebookSettings(globalLore, idx.lorebookSettings)
  const scanCorpus = buildScanText(
    query,
    memoryPipeline.memoryText,
    memoryPipeline.recentHistoryScanText,
  )
  const parts = await resolveLorebookInjectionParts(lorebookIds, {
    scanCorpus,
    conversationId,
    lorebookSettings: effectiveLore,
  })

  const loreHits: ContextRecallLoreHit[] = []
  const lorebooks = await readLorebooksByIds(lorebookIds)
  const byId = new Map(lorebooks.map((lb) => [lb.id, lb]))
  const nameToId = lorebookNameMap(lorebookIds, byId)

  for (const g of parts.constantLoreGroups) {
    const lorebookId = nameToId.get(g.lorebookName.trim()) ?? g.lorebookName
    const lorebookName = g.lorebookName.trim() || lorebookId
    for (const e of g.entries) {
      const content = e.content.trim()
      if (!content) continue
      loreHits.push({
        lorebookId,
        lorebookName,
        entryId: `constant:${lorebookId}:${e.name}`,
        title: e.name.trim() || '未命名',
        mode: 'constant',
        preview: previewText(content),
        content,
      })
    }
  }

  for (const m of parts.matchedLore) {
    const content = m.entry.content.trim()
    loreHits.push({
      lorebookId: m.lorebookId,
      lorebookName: m.lorebookName,
      entryId: m.entry.id,
      title: m.entry.title.trim() || m.entry.id,
      mode: m.mode,
      score: m.score,
      ...(m.scoreKind ? { scoreKind: m.scoreKind } : {}),
      preview: previewText(content),
      content,
    })
  }

  const knowledgeQuery = scanCorpus || query
  const knowledgeRecall = knowledgeBaseIds.length
    ? await recallKnowledgeForConversation({
        knowledgeBaseIds,
        queryText: knowledgeQuery,
        conversationId,
        knowledgeSettings: idx.knowledgeSettings,
        topK,
      })
    : { items: [], knowledgeText: '' }

  const knowledgeHits: ContextRecallKnowledgeHit[] = knowledgeRecall.items.map(
    (item) => ({
      kbId: item.kbId,
      kbName: item.kbName,
      fileId: item.fileId,
      fileName: item.fileName,
      chunkId: item.chunkId,
      ordinal: item.ordinal,
      score: item.score,
      preview: previewText(item.text),
      content: item.text,
    }),
  )

  return {
    query,
    topK,
    ...(simulateTurnOrdinal != null ? { simulateTurnOrdinal } : {}),
    loreScanCorpusChars: scanCorpus.length,
    memory: {
      hits: memoryHits,
      ...(embeddingError ? { embeddingError } : {}),
    },
    lore: {
      lorebookIds,
      hits: loreHits,
    },
    knowledge: {
      knowledgeBaseIds,
      hits: knowledgeHits,
    },
  }
}
