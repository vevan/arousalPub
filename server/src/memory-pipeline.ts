import type { HistorySettings } from './history-settings.js'
import { limitHistoryTurnRows } from './history-settings.js'
import {
  HISTORY_XML_DEFAULT_TURNS,
  type MemorySettings,
} from './memory-settings.js'
import { createEmbedding } from './embedding-client.js'
import { loadTurnsForMemoryHits } from './memory-hits.js'
import {
  searchTurnMemoryVectors,
  type MemorySearchHit,
} from './memory-store.js'
import {
  formatMemoryXml,
  buildMemoryRecallQuery,
  turnsToHistoryMessages,
  turnsToHistoryScanPlainText,
} from './turn-memory-xml.js'
import {
  readTurnsInOrdinalRange,
  readTurnsTail,
} from './chunk-chain.js'
import { type TurnRecord } from './chat-storage.js'
import { buildAllowedBranchPathsForActive } from './chunk-path.js'

export interface MemoryPipelineInput {
  conversationId: string
  userText: string
  memorySettings: MemorySettings
  historySettings: HistorySettings
  /** 再生等：不含 turnOrdinal >= 该值的轮次 */
  historyBeforeTurnOrdinalExclusive?: number | null
  /** 当前 active 分支；默认主路径 ""，召回含祖先路径 */
  activeBranchPath?: string | null
}

export interface MemoryEmbeddingCallAudit {
  latencyMs: number
  model?: string
}

export interface MemoryPipelineResult {
  /** 注入 history 的 turn 行（与 recentHistoryMessages 同源） */
  recentTurns: TurnRecord[]
  recentHistoryMessages: { role: 'user' | 'assistant'; content: string }[]
  /** 近期 history 对应 turnOrdinal（审计用） */
  recentHistoryTurnOrdinals: number[]
  /** 供 lore 扫描，非注入 XML */
  recentHistoryScanText: string
  /** 向量召回项（裁切前全量；§14.4 统一预算循环在 assemble 侧处理） */
  memoryItems: { turn: TurnRecord; score: number }[]
  /** 由 memoryItems 格式化的 XML，供 lore scanCorpus */
  memoryText: string
  memoryTurnIds: string[]
  memoryHits: MemorySearchHit[]
  embeddingCall?: MemoryEmbeddingCallAudit
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

/** 组装 / memory 热路径：尾部或再生前窗口，避免 readAllTurns */
export async function loadTurnsForMemoryPipeline(
  conversationId: string,
  historyCount: number,
  beforeExclusive?: number | null,
  activeBranchPath?: string | null,
): Promise<TurnRecord[]> {
  const slack = 2
  if (
    typeof beforeExclusive === 'number' &&
    !Number.isNaN(beforeExclusive)
  ) {
    const end = beforeExclusive - 1
    if (end < 0) return []
    const from = Math.max(0, end - historyCount - slack)
    return readTurnsInOrdinalRange(
      conversationId,
      from,
      end,
      activeBranchPath,
    )
  }
  const window = Math.max(historyCount, slack) + 1
  const { turns } = await readTurnsTail(
    conversationId,
    window,
    activeBranchPath,
  )
  return turns
}

/**
 * §14.9 阶段一：由 userInput 驱动 memory + history（lore 在之后用 scanCorpus）。
 */
export async function runMemoryPipeline(
  input: MemoryPipelineInput,
): Promise<MemoryPipelineResult> {
  const historyCount = resolveHistoryXmlTurnCount(input.historySettings)
  const pipelineTurns = await loadTurnsForMemoryPipeline(
    input.conversationId,
    historyCount,
    input.historyBeforeTurnOrdinalExclusive,
    input.activeBranchPath,
  )
  const recentTurns = selectRecentTurns(
    pipelineTurns,
    historyCount,
    input.historyBeforeTurnOrdinalExclusive,
  )
  const recentHistoryMessages = turnsToHistoryMessages(recentTurns)
  const recentHistoryScanText = turnsToHistoryScanPlainText(recentTurns)
  const recentTurnIds = new Set(recentTurns.map((t) => t.turnId))

  let memoryItems: { turn: TurnRecord; score: number }[] = []
  let memoryHits: MemorySearchHit[] = []

  const query = buildMemoryRecallQuery(
    input.userText,
    pipelineTurns,
    input.historyBeforeTurnOrdinalExclusive,
  )
  let embeddingCall: MemoryEmbeddingCallAudit | undefined
  if (input.memorySettings.memoryEnabled && query.length > 0) {
    const embStarted = performance.now()
    const emb = await createEmbedding(query, input.conversationId)
    if (emb) {
      embeddingCall = {
        latencyMs: Math.round(performance.now() - embStarted),
        model: emb.model,
      }
      const minRecentOrdinal =
        recentTurns.length > 0
          ? Math.min(...recentTurns.map((t) => t.turnOrdinal))
          : undefined
      memoryHits = await searchTurnMemoryVectors(
        input.conversationId,
        emb.vector,
        query,
        input.memorySettings.memoryTopK,
        recentTurnIds,
        minRecentOrdinal,
        buildAllowedBranchPathsForActive(input.activeBranchPath),
      )
      memoryItems = await loadTurnsForMemoryHits(
        input.conversationId,
        memoryHits,
        recentTurnIds,
      )
    }
  }

  const memoryText = formatMemoryXml(memoryItems)
  const memoryTurnIds = memoryItems.map((x) => x.turn.turnId)

  return {
    recentTurns,
    recentHistoryMessages,
    recentHistoryTurnOrdinals: recentTurns.map((t) => t.turnOrdinal),
    recentHistoryScanText,
    memoryItems,
    memoryText,
    memoryTurnIds,
    memoryHits,
    ...(embeddingCall ? { embeddingCall } : {}),
  }
}
