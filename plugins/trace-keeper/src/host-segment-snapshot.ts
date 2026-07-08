export type HostSegmentSnapshot = {
  receives: { id: string; content: string }[]
  activeReceiveIndex: number
}

export type HostTurnWithSegments = {
  segments: HostSegmentSnapshot[]
  activeSegmentIndex: number
}

export type SegmentIndexBodyResolve =
  | { kind: 'ok'; segmentIndex: number }
  | { kind: 'default' }
  | { kind: 'error'; code: 'invalid_segment_index' | 'receive_not_found' }

export function activeReceiveFromSegment(
  seg: HostSegmentSnapshot,
): { id: string; content: string } | null {
  const receives = seg.receives ?? []
  if (!receives.length) return null
  const idx = Math.min(
    Math.max(0, Math.floor(seg.activeReceiveIndex)),
    receives.length - 1,
  )
  return receives[idx] ?? null
}

export function resolveSegmentIndexFromBody(
  turn: HostTurnWithSegments,
  body: Record<string, unknown>,
): SegmentIndexBodyResolve {
  const hasSegmentIndex =
    typeof body.segmentIndex === 'number' && Number.isFinite(body.segmentIndex)
  const receiveId =
    typeof body.receiveId === 'string' ? body.receiveId.trim() : ''

  if (hasSegmentIndex) {
    const idx = Math.round(body.segmentIndex as number)
    if (idx >= 0 && idx < turn.segments.length) {
      return { kind: 'ok', segmentIndex: idx }
    }
    if (!receiveId) {
      return { kind: 'error', code: 'invalid_segment_index' }
    }
  }

  if (receiveId) {
    for (let i = 0; i < turn.segments.length; i += 1) {
      const seg = turn.segments[i]!
      for (const r of seg.receives) {
        if (r.id?.trim() === receiveId) return { kind: 'ok', segmentIndex: i }
      }
    }
    return { kind: 'error', code: 'receive_not_found' }
  }

  return { kind: 'default' }
}

export function segmentIndexForAction(
  snap: HostTurnWithSegments,
  body: Record<string, unknown>,
):
  | { ok: true; segmentIndex?: number }
  | { ok: false; code: string; status: number } {
  const resolved = resolveSegmentIndexFromBody(snap, body)
  if (resolved.kind === 'error') {
    const status = resolved.code === 'receive_not_found' ? 404 : 400
    return { ok: false, code: resolved.code, status }
  }
  if (resolved.kind === 'ok') {
    return { ok: true, segmentIndex: resolved.segmentIndex }
  }
  return { ok: true }
}

export function activeSegmentReceive(
  turn: HostTurnWithSegments,
  segmentIndex?: number,
): { id: string; content: string } | null {
  const segments = turn.segments
  if (!segments.length) return null
  let segIdx: number
  if (typeof segmentIndex === 'number' && Number.isFinite(segmentIndex)) {
    segIdx = Math.floor(segmentIndex)
    if (segIdx < 0 || segIdx >= segments.length) return null
  } else {
    segIdx = Math.min(
      Math.max(0, Math.floor(turn.activeSegmentIndex)),
      segments.length - 1,
    )
  }
  const seg = segments[segIdx]
  if (!seg) return null
  return activeReceiveFromSegment(seg)
}

export function turnHasAssistantReceives(turn: HostTurnWithSegments): boolean {
  return turn.segments.some((s) => (s.receives?.length ?? 0) > 0)
}
