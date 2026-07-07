import {
  formatEntryTitle,
  normalizeSidecarPayload,
  normalizeSummaryPayload,
  parseModelJson,
} from '../shared/summarize.js'
import { PLOT_SUMMARY_COMPLETE_LAYOUT } from '../shared/summary-prompt-layout.js'
import { formatPlotSummaryLayoutBlocks } from '../shared/plot-summary-context-blocks.js'
import type { PluginContextBlocksSuccess } from '../../../../shared/plugin-context-blocks.js'

export { PLOT_SUMMARY_COMPLETE_LAYOUT }

export function formatPluginContextBlocks(
  resolved: PluginContextBlocksSuccess,
  _ctx?: { anchorToTurn: number },
): Record<string, string> {
  return formatPlotSummaryLayoutBlocks(resolved)
}

type DraftParseContext = {
  pluginId: string
  conversationId: string
  apiConfigId?: string
  kind: 'memory' | 'sidecar'
  fromTurn?: number
  toTurn?: number
  blockTurns?: number
  sidecarName?: string
}

export function parseCompleteDraftContent(
  ctx: DraftParseContext,
  content: string,
  _api: unknown,
): { draft: { title: string; content: string; keywords: string[] } } {
  const raw = parseModelJson(content)

  if (ctx.kind === 'sidecar') {
    const sidecar = normalizeSidecarPayload(ctx.sidecarName ?? '', raw)
    return {
      draft: {
        title: ctx.sidecarName?.trim() || sidecar.title,
        content: sidecar.content,
        keywords: sidecar.keywords,
      },
    }
  }

  const summary = normalizeSummaryPayload(raw)
  const fromTurn = typeof ctx.fromTurn === 'number' ? ctx.fromTurn : 0
  const toTurn = typeof ctx.toTurn === 'number' ? ctx.toTurn : fromTurn
  const blockTurns =
    typeof ctx.blockTurns === 'number' && Number.isFinite(ctx.blockTurns)
      ? Math.max(1, Math.round(ctx.blockTurns))
      : 15
  const entryTitle = formatEntryTitle(summary.title, fromTurn, toTurn, blockTurns)
  return {
    draft: {
      title: entryTitle,
      content: summary.content,
      keywords: summary.keywords,
    },
  }
}
