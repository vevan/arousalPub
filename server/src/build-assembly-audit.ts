import type { LorebookInjectionParts } from './lorebook-resolve.js'
import type { MemoryPipelineResult } from './memory-pipeline.js'
import type { AssemblyAudit } from './chat-audit-types.js'
import type { PromptBudgetTrimState } from './prompt-budget-trim.js'
import type { LorebookXmlGroup } from './prompt-xml.js'
import type { ChatMessage } from './assemble-prompts.js'
import { countChatMessagesTokens } from './token-count.js'

export interface BuildAssemblyAuditParams {
  estimatedTokens: number
  tokenModel?: string
  maxTokens?: number
  trimMaxTokens?: number
  tokensBeforeTrim?: number
  lorebookIds: string[]
  lorebookNameToId: Map<string, string>
  memoryPipeline: MemoryPipelineResult
  loreParts: LorebookInjectionParts
  initialMatchedLore: LorebookInjectionParts['matchedLore']
  initialMemoryItems: MemoryPipelineResult['memoryItems']
  trimState: PromptBudgetTrimState
  droppedLoreCount: number
  droppedMemoryCount: number
  droppedHistoryCount: number
  memoryEnabled: boolean
  pluginAdditionCache?: Map<string, ChatMessage[] | null>
}

function constantLoreMatches(
  groups: LorebookXmlGroup[],
  lorebookNameToId: Map<string, string>,
  fallbackLorebookId: string,
): AssemblyAudit['lore']['matched'] {
  const out: AssemblyAudit['lore']['matched'] = []
  for (const g of groups) {
    const name = g.lorebookName.trim() || '未命名'
    const lorebookId = lorebookNameToId.get(name) ?? fallbackLorebookId
    for (const e of g.entries) {
      if (!e.content.trim()) continue
      out.push({
        lorebookId,
        entryId: `constant:${name}:${e.name}`,
        title: e.name.trim() || undefined,
        mode: 'constant',
        included: true,
      })
    }
  }
  return out
}

function buildPluginAssemblyAudit(
  cache: Map<string, ChatMessage[] | null> | undefined,
  tokenModel?: string,
): AssemblyAudit['plugins'] | undefined {
  if (!cache?.size) return undefined
  const items: { pluginId: string; tokens: number }[] = []
  let tokenReserve = 0
  for (const [pluginId, addition] of cache) {
    if (!addition?.length) continue
    const tokens = countChatMessagesTokens(addition, { model: tokenModel })
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
    ...constantLoreMatches(
      params.loreParts.constantLoreGroups,
      params.lorebookNameToId,
      params.lorebookIds[0] ?? 'unknown',
    ),
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
    history: {
      turnOrdinals: params.memoryPipeline.recentHistoryTurnOrdinals,
      droppedCount: params.droppedHistoryCount,
    },
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
