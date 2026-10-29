import type { ChatMessage } from './assemble-prompts.js'
import type { LorebookInjectionParts } from './lorebook-resolve.js'
import type { MemoryPipelineResult } from './memory-pipeline.js'
import type { AssemblyAudit } from './chat-audit-types.js'
import type {
  ConstantLoreItem,
  PromptBudgetTrimState,
} from './prompt-budget-trim.js'
import type { KnowledgeHitItem } from './knowledge-resolve.js'
import {
  countPluginAssembleAdditionTokens,
  type PluginAssembleAdditionCache,
} from './plugin-host.js'

/** 从 history 消息链提取按出现序去重的 turnOrdinal（纳入轮次） */
export function historyTurnOrdinalsFromMessages(
  messages: readonly ChatMessage[],
): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const m of messages) {
    const ord = m.turnOrdinal
    if (typeof ord !== 'number' || !Number.isFinite(ord)) continue
    if (seen.has(ord)) continue
    seen.add(ord)
    out.push(ord)
  }
  return out
}

/** 相对裁切前轮次列表，计算被整轮移出的数量（与「纳入轮次」同口径） */
export function countDroppedHistoryTurns(
  initialOrdinals: readonly number[],
  remainingOrdinals: readonly number[],
): number {
  const remaining = new Set(remainingOrdinals)
  let n = 0
  for (const ord of initialOrdinals) {
    if (!remaining.has(ord)) n += 1
  }
  return n
}

/**
 * 裁切后 history 审计：纳入轮次 + 裁切轮数。
 * 若仍有消息但均无 turnOrdinal，不谎报「全部裁掉」。
 */
export function resolveHistoryTrimAudit(
  initialOrdinals: readonly number[],
  remainingMessages: readonly ChatMessage[],
): { turnOrdinals: number[]; droppedCount: number } {
  const turnOrdinals = historyTurnOrdinalsFromMessages(remainingMessages)
  if (remainingMessages.length > 0 && turnOrdinals.length === 0) {
    return { turnOrdinals: [], droppedCount: 0 }
  }
  return {
    turnOrdinals,
    droppedCount: countDroppedHistoryTurns(initialOrdinals, turnOrdinals),
  }
}

export interface BuildAssemblyAuditParams {
  estimatedTokens: number
  tokenModel?: string
  maxTokens?: number
  trimMaxTokens?: number
  tokensBeforeTrim?: number
  lorebookIds: string[]
  lorebookNameToId: Map<string, string>
  knowledgeBaseIds: string[]
  knowledgeEnabled: boolean
  initialKnowledgeItems: KnowledgeHitItem[]
  droppedKnowledgeCount: number
  memoryPipeline: MemoryPipelineResult
  loreParts: LorebookInjectionParts
  initialMatchedLore: LorebookInjectionParts['matchedLore']
  initialMemoryItems: MemoryPipelineResult['memoryItems']
  trimState: PromptBudgetTrimState
  droppedLoreCount: number
  droppedMemoryCount: number
  memoryEnabled: boolean
  pluginAdditionCache?: PluginAssembleAdditionCache
}

function constantLoreMatches(
  items: ConstantLoreItem[],
): AssemblyAudit['lore']['matched'] {
  const out: AssemblyAudit['lore']['matched'] = []
  for (const c of items) {
    const content = c.entry.content.trim()
    if (!content) continue
    out.push({
      lorebookId: c.lorebookId,
      entryId: c.entry.id,
      title: c.entry.title.trim() || undefined,
      mode: 'constant',
      included: true,
    })
  }
  return out
}

function buildPluginAssemblyAudit(
  cache: PluginAssembleAdditionCache | undefined,
  tokenModel?: string,
): AssemblyAudit['plugins'] | undefined {
  if (!cache?.size) return undefined
  const items: { pluginId: string; tokens: number }[] = []
  let tokenReserve = 0
  for (const [pluginId, addition] of cache) {
    if (!addition) continue
    const tokens = countPluginAssembleAdditionTokens(addition, tokenModel)
    items.push({ pluginId, tokens })
    tokenReserve += tokens
  }
  if (items.length === 0) return undefined
  return { tokenReserve, items }
}

export function buildAssemblyAudit(
  params: BuildAssemblyAuditParams,
): AssemblyAudit {
  const includedMemoryIds = new Set(
    params.trimState.memoryItems.map((x) => x.turn.turnId),
  )
  const includedLoreIds = new Set(
    params.trimState.matchedLore.map((x) => x.entry.id),
  )
  const includedKnowledgeIds = new Set(
    params.trimState.knowledgeItems.map((x) => x.chunkId),
  )

  const memoryHits: AssemblyAudit['memory']['hits'] = []
  for (const item of params.initialMemoryItems) {
    memoryHits.push({
      turnId: item.turn.turnId,
      turnOrdinal: item.turn.turnOrdinal,
      score: item.score,
      included: includedMemoryIds.has(item.turn.turnId),
    })
  }
  for (const h of params.memoryPipeline.memoryHits) {
    if (memoryHits.some((x) => x.turnId === h.turnId)) continue
    memoryHits.push({
      turnId: h.turnId,
      turnOrdinal: h.turnOrdinal,
      score: h.score,
      included: includedMemoryIds.has(h.turnId),
    })
  }
  memoryHits.sort((a, b) => b.score - a.score)

  const matched: AssemblyAudit['lore']['matched'] = [
    ...constantLoreMatches(params.loreParts.constantLore),
  ]
  for (const m of params.initialMatchedLore) {
    matched.push({
      lorebookId: m.lorebookId,
      entryId: m.entry.id,
      title: m.entry.title?.trim() || undefined,
      mode: m.mode,
      score: m.score,
      ...(m.scoreKind ? { scoreKind: m.scoreKind } : {}),
      included: includedLoreIds.has(m.entry.id),
    })
  }

  const knowledgeHits: NonNullable<AssemblyAudit['knowledge']>['hits'] =
    params.initialKnowledgeItems.map((item) => ({
      kbId: item.kbId,
      kbName: item.kbName,
      fileId: item.fileId,
      fileName: item.fileName,
      chunkId: item.chunkId,
      ordinal: item.ordinal,
      score: item.score,
      included: includedKnowledgeIds.has(item.chunkId),
    }))
  knowledgeHits.sort((a, b) => b.score - a.score)

  const pluginAudit = buildPluginAssemblyAudit(
    params.pluginAdditionCache,
    params.tokenModel,
  )

  return {
    estimatedTokens: params.estimatedTokens,
    ...(params.tokenModel ? { tokenModel: params.tokenModel } : {}),
    memory: {
      enabled: params.memoryEnabled,
      hits: memoryHits,
      droppedCount: params.droppedMemoryCount,
    },
    lore: {
      lorebookIds: params.lorebookIds,
      matched,
      droppedCount: params.droppedLoreCount,
    },
    knowledge: {
      knowledgeBaseIds: params.knowledgeBaseIds,
      enabled: params.knowledgeEnabled,
      hits: knowledgeHits,
      droppedCount: params.droppedKnowledgeCount,
    },
    history: resolveHistoryTrimAudit(
      params.memoryPipeline.recentHistoryTurnOrdinals,
      params.trimState.historyMessages,
    ),
    ...(params.maxTokens || params.trimMaxTokens || params.tokensBeforeTrim
      ? {
          budgetTrim: {
            ...(params.maxTokens ? { maxTokens: params.maxTokens } : {}),
            ...(params.trimMaxTokens
              ? { trimMaxTokens: params.trimMaxTokens }
              : {}),
            ...(params.tokensBeforeTrim != null
              ? { tokensBeforeTrim: params.tokensBeforeTrim }
              : {}),
          },
        }
      : {}),
    ...(pluginAudit ? { plugins: pluginAudit } : {}),
  }
}
