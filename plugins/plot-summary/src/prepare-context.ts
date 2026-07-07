import type { ContextBlockSpec } from '../../../shared/plugin-context-blocks.js'
import {
  applyPlotSummaryLoreEntryIds,
  buildPlotSummaryContextBlockSpecs,
  plotSummaryReferenceAndHistory,
  type PlotSummaryPrepareInput,
} from './shared/plot-summary-context-blocks.js'
import type { PluginHost, MergedSettings } from './types.js'
import { outgoingTailOrdinal } from './settings.js'

export type PlotSummaryPreparedContext = {
  systemReferenceContext: string
  userContent: string
  contextBlocks: ContextBlockSpec[]
  meta: { userDisplayName: string; assistantDisplayName: string }
}

export async function preparePlotSummarySummarizeContext(
  host: PluginHost,
  settings: MergedSettings,
  fromTurn: number,
  toTurn: number,
): Promise<PlotSummaryPreparedContext> {
  const sidecarEntryIds = settings.sidecarEntryIds
  const sidecarConfigIds = settings.sidecars.map((s) => s.id)

  const input: PlotSummaryPrepareInput = {
    fromTurn,
    toTurn,
    targetLorebookId: settings.targetLorebookId,
    previousSummariesLimit: settings.previousSummariesLimit,
    sidecarEntryIds,
    sidecarConfigIds,
    regexRuleIds: settings.regexRuleIds,
    regexApplyAllTurns: settings.regexApplyAllTurns,
    tailOrdinal: outgoingTailOrdinal(host),
  }

  let specs = buildPlotSummaryContextBlockSpecs(input)
  const lb = await host.lorebook.get(settings.targetLorebookId)
  const entries = (lb.entries ?? []).map((e) => ({
    id: e.id,
    groupId: typeof e.groupId === 'string' ? e.groupId : '',
    title: typeof e.title === 'string' ? e.title : '',
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : undefined,
  }))
  specs = applyPlotSummaryLoreEntryIds(specs, entries, input)

  const resolved = await host.plugin.prepareContextBlocks({ blocks: specs })
  const { systemReferenceContext, userContent } =
    plotSummaryReferenceAndHistory(resolved)

  return {
    systemReferenceContext,
    userContent,
    contextBlocks: specs,
    meta: resolved.meta,
  }
}
