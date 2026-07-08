import type {
  ContextBlockSpec,
  PluginContextBlocksSuccess,
} from '../../../../shared/plugin-context-blocks.js'
import { BLOCK_TAG } from '../constants.js'
import { SEPARATE_TURN_COUNT_MIN } from '../separate-turn-settings.js'

export const TK_BLOCK_DIALOGUE_RAW = 'dialogueRaw'

export function buildTraceKeeperSeparateBlockSpecs(input: {
  targetOrdinal: number
  windowTurnCount: number
  targetSegmentIndex?: number
}): ContextBlockSpec[] {
  const cap = Math.max(
    SEPARATE_TURN_COUNT_MIN,
    Math.floor(input.windowTurnCount),
  )
  const fromTurn = Math.max(0, input.targetOrdinal - cap + 1)
  const segIdx = input.targetSegmentIndex
  return [
    {
      source: 'conversation.transcript',
      blockId: TK_BLOCK_DIALOGUE_RAW,
      fromTurn,
      toTurn: input.targetOrdinal,
      tailOrdinal: input.targetOrdinal,
      stripBlockTagsOnToTurn: [BLOCK_TAG],
      ...(typeof segIdx === 'number' && Number.isFinite(segIdx)
        ? { stripBlockTagsOnToTurnSegmentIndex: Math.round(segIdx) }
        : {}),
    },
  ]
}

export function buildDialogueBlock(transcript: string): string {
  const body = (transcript ?? '').trim()
  if (!body) return ''
  return `<dialogue>\n${body}\n</dialogue>`
}

/** 步骤 1 响应 → layout 用 blocks */
export function formatTraceKeeperLayoutBlocks(
  resolved: PluginContextBlocksSuccess,
): Record<string, string> {
  const raw = resolved.blocks[TK_BLOCK_DIALOGUE_RAW] ?? ''
  const dialogue = buildDialogueBlock(raw)
  return dialogue ? { dialogue } : {}
}
