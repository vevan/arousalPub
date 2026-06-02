import type { HistorySettings } from './history-settings.js'
import { limitHistoryTurnRows } from './history-settings.js'
import {
  HISTORY_XML_DEFAULT_TURNS,
  type MemorySettings,
} from './memory-settings.js'
import { createEmbedding } from './embedding-client.js'
import {
  searchTurnMemoryVectors,
  type MemorySearchHit,
} from './memory-store.js'
import {
  formatHistoryXml,
  formatMemoryXml,
  buildMemoryRecallQuery,
} from './turn-memory-xml.js'
import { resolveTurnById } from './turn-resolve.js'
import { readAllTurns } from './chunk-chain.js'
import { type TurnRecord } from './chat-storage.js'

export interface MemoryPipelineInput {
  conversationId: string
  userText: string
  memorySettings: MemorySettings
  historySettings: HistorySettings
  /** 再生等：不含 turnOrdinal >= 该值的轮次 */
  historyBeforeTurnOrdinalExclusive?: number | null
}

export interface MemoryPipelineResult {
  recentHistoryText: string
  memoryText: string
  memoryTurnIds: string[]
  memoryHits: MemorySearchHit[]
}

/** 近期 history XML 窗口轮数 */
export function resolveHistoryXmlTurnCount(
  historySettings: HistorySettings,
): number {
  if (historySettings.limitEnabled) {
    return Math.max(1, Math.floor(historySettings.maxTurns))
  }
  return HISTORY_XML_DEFAULT_TURNS
}

function selectRecentTurns(
  all: TurnRecord[],
  count: number,
  beforeExclusive?: number | null,
): TurnRecord[] {
  let rows = all.slice()
  if (
    typeof beforeExclusive === 'number' &&
    !Number.isNaN(beforeExclusive)
  ) {
    rows = rows.filter((t) => t.turnOrdinal < beforeExclusive)
  }
  rows.sort((a, b) => a.turnOrdinal - b.turnOrdinal)
  const limited = limitHistoryTurnRows(rows, {
    limitEnabled: true,
    maxTurns: count,
  })
  return limited
}

/**
 * §14.9 阶段一：由 userInput 驱动 memory + history（lore 在之后用 scanCorpus）。
 */
export async function runMemoryPipeline(
  input: MemoryPipelineInput,
): Promise<MemoryPipelineResult> {
  const allTurns = await readAllTurns(input.conversationId)
  const historyCount = resolveHistoryXmlTurnCount(input.historySettings)
  const recentTurns = selectRecentTurns(
    allTurns,
    historyCount,
    input.historyBeforeTurnOrdinalExclusive,
  )
  const recentHistoryText = formatHistoryXml(recentTurns)
  const recentTurnIds = new Set(recentTurns.map((t) => t.turnId))

  let memoryText = ''
  let memoryTurnIds: string[] = []
  let memoryHits: MemorySearchHit[] = []

  const query = buildMemoryRecallQuery(
    input.userText,
    allTurns,
    input.historyBeforeTurnOrdinalExclusive,
  )
  if (input.memorySettings.memoryEnabled && query.length > 0) {
    const emb = await createEmbedding(query)
    if (emb) {
      const minRecentOrdinal =
        recentTurns.length > 0
          ? Math.min(...recentTurns.map((t) => t.turnOrdinal))
          : undefined
      memoryHits = await searchTurnMemoryVectors(
        input.conversationId,
        emb.vector,
        input.memorySettings.memoryTopK,
        recentTurnIds,
        minRecentOrdinal,
      )
      const items: { turn: TurnRecord; score: number }[] = []
      for (const hit of memoryHits) {
        const turn = await resolveTurnById(input.conversationId, hit.turnId)
        if (!turn || recentTurnIds.has(turn.turnId)) continue
        items.push({ turn, score: hit.score })
        memoryTurnIds.push(turn.turnId)
      }
      memoryText = formatMemoryXml(items)
    }
  }

  return {
    recentHistoryText,
    memoryText,
    memoryTurnIds,
    memoryHits,
  }
}
