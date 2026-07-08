import type { ContextBlockSpec } from '../../../shared/plugin-context-blocks.js'
import { buildTraceKeeperSeparateBlockSpecs } from './shared/trace-keeper-context-blocks.js'

export function prepareTraceKeeperSeparateContextBlocks(input: {
  targetOrdinal: number
  windowTurnCount: number
  targetSegmentIndex?: number
}): ContextBlockSpec[] {
  return buildTraceKeeperSeparateBlockSpecs(input)
}
