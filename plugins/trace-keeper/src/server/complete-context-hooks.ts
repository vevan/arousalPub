import type { PluginContextBlocksSuccess } from '../../../../shared/plugin-context-blocks.js'
import { formatTraceKeeperLayoutBlocks } from '../shared/trace-keeper-context-blocks.js'
import { TRACE_KEEPER_SEPARATE_LAYOUT } from '../shared/separate-prompt-layout.js'

export { TRACE_KEEPER_SEPARATE_LAYOUT }

export function formatPluginContextBlocks(
  resolved: PluginContextBlocksSuccess,
  _ctx?: { anchorToTurn: number },
): Record<string, string> {
  return formatTraceKeeperLayoutBlocks(resolved)
}
