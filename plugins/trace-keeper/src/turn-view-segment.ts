import type { TraceTurnRef } from './trace-state-resolve.js'

export type TurnViewRef = TraceTurnRef & {
  turnOrdinal: number
  /** Web parse 时 derived（= 某 segment）；segment-scoped 视图亦可能仅带 flat receives */
  receives?: { id?: string; content?: string }[]
  activeReceiveIndex?: number
  speakerCharacterId?: string
}

export function resolveViewSegmentIndex(
  turn: TraceTurnRef,
  segmentIndex?: number,
): number {
  const segments = turn.segments ?? []
  if (segments.length === 0) return 0
  const raw =
    typeof segmentIndex === 'number' && Number.isFinite(segmentIndex)
      ? Math.floor(segmentIndex)
      : Math.floor(turn.activeSegmentIndex ?? 0)
  return Math.min(Math.max(0, raw), segments.length - 1)
}

export function viewSegmentAt(
  turn: TurnViewRef,
  segmentIndex?: number,
): {
  receives: { id?: string; content?: string }[]
  activeReceiveIndex: number
  speakerCharacterId?: string
} | null {
  const segments = turn.segments
  if (segments?.length) {
    const seg = segments[resolveViewSegmentIndex(turn, segmentIndex)]!
    return {
      receives: seg.receives ?? [],
      activeReceiveIndex:
        typeof seg.activeReceiveIndex === 'number' ? seg.activeReceiveIndex : 0,
      ...(typeof (seg as { speakerCharacterId?: string }).speakerCharacterId ===
      'string'
        ? {
            speakerCharacterId: (
              seg as { speakerCharacterId?: string }
            ).speakerCharacterId!.trim(),
          }
        : {}),
    }
  }
  const receives = turn.receives ?? []
  if (receives.length === 0) return null
  return {
    receives,
    activeReceiveIndex:
      typeof turn.activeReceiveIndex === 'number' ? turn.activeReceiveIndex : 0,
    ...(turn.speakerCharacterId?.trim()
      ? { speakerCharacterId: turn.speakerCharacterId.trim() }
      : {}),
  }
}

export function activeReceiveFromView(
  turn: TurnViewRef,
  segmentIndex?: number,
): { id?: string; content?: string } | null {
  const seg = viewSegmentAt(turn, segmentIndex)
  const receives = seg?.receives ?? []
  if (!receives.length) return null
  const idx = Math.min(
    Math.max(0, Math.floor(seg?.activeReceiveIndex ?? 0)),
    receives.length - 1,
  )
  return receives[idx] ?? null
}

export function turnHasAssistantReceives(turn: TurnViewRef): boolean {
  if (turn.segments?.some((s) => (s.receives?.length ?? 0) > 0)) return true
  return (turn.receives?.length ?? 0) > 0
}
