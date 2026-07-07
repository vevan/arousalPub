import type {
  ContextBlockSpec,
  LorebookEntrySlice,
  PluginContextBlocksSuccess,
} from '../../../../shared/plugin-context-blocks.js'
import {
  pickRecentSummaryEntriesBeforeTurn,
  sortPlotSummaryEntriesInGroup,
  type PlotSummaryLoreEntry,
} from './lorebook-sort.js'
import {
  buildHistoryBlock,
  buildPreviousSummariesBlock,
  buildSidecarsBlock,
} from './prepare-context-blocks.js'

export const PS_BLOCK_PREV = 'prevSummaries'
export const PS_BLOCK_SIDECARS = 'sidecars'
export const PS_BLOCK_HISTORY_RAW = 'historyRaw'

export type PlotSummaryPrepareInput = {
  fromTurn: number
  toTurn: number
  targetLorebookId: string
  previousSummariesLimit: number
  sidecarEntryIds: Record<string, string>
  sidecarConfigIds: string[]
  regexRuleIds?: string[]
  regexApplyAllTurns?: boolean
  tailOrdinal?: number
  includePreviousMemories?: boolean
}

export function buildPlotSummaryContextBlockSpecs(
  input: PlotSummaryPrepareInput,
): ContextBlockSpec[] {
  const { fromTurn, toTurn } = input

  const blocks: ContextBlockSpec[] = [
    {
      source: 'conversation.transcript',
      blockId: PS_BLOCK_HISTORY_RAW,
      fromTurn,
      toTurn,
      regexRuleIds: input.regexRuleIds,
      regexApplyAllTurns: input.regexApplyAllTurns,
      tailOrdinal: input.tailOrdinal,
    },
  ]

  if (input.includePreviousMemories !== false) {
    blocks.push({
      source: 'lorebook.entries',
      blockId: PS_BLOCK_PREV,
      lorebookId: input.targetLorebookId,
      entryIds: [],
    })
    blocks.push({
      source: 'lorebook.entries',
      blockId: PS_BLOCK_SIDECARS,
      lorebookId: input.targetLorebookId,
      entryIds: [],
    })
  }

  return blocks
}

/** 插件侧选条后写入 lorebook.entries 的 entryIds */
export function applyPlotSummaryLoreEntryIds(
  specs: ContextBlockSpec[],
  loreEntries: PlotSummaryLoreEntry[],
  input: PlotSummaryPrepareInput,
): ContextBlockSpec[] {
  const sidecarSet = new Set(Object.values(input.sidecarEntryIds))
  const limit = Math.max(0, Math.min(50, Math.round(input.previousSummariesLimit)))

  const prevIds =
    input.includePreviousMemories === false
      ? []
      : pickRecentSummaryEntriesBeforeTurn(
          loreEntries,
          input.fromTurn,
          sidecarSet,
          limit,
          input.sidecarEntryIds,
          input.sidecarConfigIds,
        ).map((e) => e.id)

  const sidecarIds = sortPlotSummaryEntriesInGroup(
    loreEntries.filter((e) => sidecarSet.has(e.id)),
    input.sidecarEntryIds,
    input.sidecarConfigIds,
  ).map((e) => e.id)

  return specs.map((spec) => {
    if (spec.source !== 'lorebook.entries') return spec
    if (spec.blockId === PS_BLOCK_PREV) {
      return { ...spec, entryIds: prevIds }
    }
    if (spec.blockId === PS_BLOCK_SIDECARS) {
      return { ...spec, entryIds: sidecarIds }
    }
    return spec
  })
}

function slicesToTitleContent(entries: LorebookEntrySlice[]): { title: string; content: string }[] {
  return entries.map((e) => ({
    title: e.title,
    content: e.content,
  }))
}

/** 步骤 1 响应 → layout 用 blocks（含 XML 包裹） */
export function formatPlotSummaryLayoutBlocks(
  resolved: PluginContextBlocksSuccess,
): Record<string, string> {
  const prev = resolved.entriesByBlock[PS_BLOCK_PREV] ?? []
  const sidecars = resolved.entriesByBlock[PS_BLOCK_SIDECARS] ?? []
  const historyRaw = resolved.blocks[PS_BLOCK_HISTORY_RAW] ?? ''

  const prevBlock = buildPreviousSummariesBlock(slicesToTitleContent(prev))
  const sidecarBlock = buildSidecarsBlock(slicesToTitleContent(sidecars))
  const historyBlock = buildHistoryBlock(historyRaw)

  const reference = `${prevBlock}${sidecarBlock}`.trim()
  const history = historyBlock.trim()

  return {
    reference,
    history,
  }
}

export function plotSummaryReferenceAndHistory(resolved: PluginContextBlocksSuccess): {
  systemReferenceContext: string
  userContent: string
} {
  const layoutBlocks = formatPlotSummaryLayoutBlocks(resolved)
  return {
    systemReferenceContext: layoutBlocks.reference ?? '',
    userContent: layoutBlocks.history ?? '',
  }
}
