const PLUGIN_ID = 'swipe-cleaner'
const BATCH_MAX = 50

type SwipeReceive = {
  id?: string
  content?: string
  reasoning?: string
  durationMs?: number
  estimatedTokens?: number
  completionTokens?: number
  model?: string
}

type SwipeSegment = {
  receives?: SwipeReceive[]
  activeReceiveIndex?: number
}

type SwipeTurn = {
  turnOrdinal?: number
  user?: string
  segments?: SwipeSegment[]
  activeSegmentIndex?: number
}

type PruneTurnDto = {
  turnOrdinal: number
  user?: string
  segmentIndex: number
  receives: SwipeReceive[]
  activeReceiveIndex: number
}

type SwipeCleanerHost = {
  pluginKey: (key: string) => string
  t: (key: string, params?: Record<string, unknown>) => string
  session: {
    turns: SwipeTurn[]
    conversationWriteLocked: boolean
    loading: boolean
    regeneratingTurnOrdinal: number | null
  }
  conversation: {
    runBatch: (fn: (ctx: SwipeBatchCtx) => Promise<void>) => Promise<void>
    refresh: () => Promise<void>
  }
  ui: {
    confirm: (opts: {
      title: string
      body: string
      confirmLabel: string
      cancelLabel: string
      confirmColor?: string
    }) => Promise<boolean>
    notify: (
      title: string,
      body?: string,
      opts?: { level?: 'info' | 'success' | 'warning' | 'error' },
    ) => void
  }
  registerSlotButton: (
    slot: string,
    def: Record<string, unknown>,
  ) => void
}

type SwipeBatchCtx = {
  patchTurns: (dtos: PruneTurnDto[]) => Promise<{ failed?: Array<{ error?: string }> }>
}

type SwipeSlotCtx = {
  turn?: SwipeTurn
  segmentIndex?: number
}

function getActiveSegmentIndex(turn: SwipeTurn): number {
  const segments = turn.segments ?? []
  if (segments.length === 0) return 0
  const raw = turn.activeSegmentIndex ?? 0
  return Math.min(Math.max(0, raw), segments.length - 1)
}

function getSegmentReceives(turn: SwipeTurn, segmentIndex?: number): SwipeReceive[] {
  const segments = turn.segments ?? []
  if (segments.length === 0) return []
  const idx =
    typeof segmentIndex === 'number' && Number.isFinite(segmentIndex)
      ? segmentIndex
      : getActiveSegmentIndex(turn)
  return segments[idx]?.receives ?? []
}

function getActiveReceiveIndex(turn: SwipeTurn, segmentIndex?: number): number {
  const segments = turn.segments ?? []
  if (segments.length === 0) return 0
  const idx =
    typeof segmentIndex === 'number' && Number.isFinite(segmentIndex)
      ? segmentIndex
      : getActiveSegmentIndex(turn)
  const seg = segments[idx]
  const receives = seg?.receives ?? []
  if (receives.length === 0) return 0
  const ai = seg?.activeReceiveIndex ?? 0
  return Math.min(Math.max(0, ai), receives.length - 1)
}

function pruneDto(turn: PruneTurnDto): PruneTurnDto | null {
  if (!turn.receives || turn.receives.length <= 1) return null
  const idx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex) || 0),
    turn.receives.length - 1,
  )
  const kept = turn.receives[idx]
  if (!kept) return null
  return {
    ...turn,
    receives: [kept],
    activeReceiveIndex: 0,
  }
}

function turnItemToDto(turn: SwipeTurn, segmentIndex: number): PruneTurnDto {
  const receives = getSegmentReceives(turn, segmentIndex)
  return {
    turnOrdinal: turn.turnOrdinal ?? 0,
    user: turn.user,
    segmentIndex,
    receives: receives.map((r) => ({
      id: r.id,
      content: r.content,
      ...(r.reasoning ? { reasoning: r.reasoning } : {}),
      ...(r.durationMs ? { durationMs: r.durationMs } : {}),
      ...(r.estimatedTokens ? { estimatedTokens: r.estimatedTokens } : {}),
      ...(r.completionTokens ? { completionTokens: r.completionTokens } : {}),
      ...(r.model ? { model: r.model } : {}),
    })),
    activeReceiveIndex: getActiveReceiveIndex(turn, segmentIndex),
  }
}

function segmentSwipeCount(turn: SwipeTurn, segmentIndex?: number): number {
  return getSegmentReceives(turn, segmentIndex).length
}

function isBusy(host: SwipeCleanerHost): boolean {
  return (
    host.session.conversationWriteLocked ||
    host.session.loading ||
    host.session.regeneratingTurnOrdinal !== null
  )
}

function conversationHasSwipes(host: SwipeCleanerHost): boolean {
  const turns = host.session.turns
  if (!Array.isArray(turns)) return false
  return turns.some((t) =>
    (t.segments ?? []).some((seg) => (seg.receives?.length ?? 0) > 1),
  )
}

function summarizeConversation(host: SwipeCleanerHost): {
  turnCount: number
  swipeRemoveTotal: number
} {
  let turnCount = 0
  let swipeRemoveTotal = 0
  for (const t of host.session.turns ?? []) {
    for (const seg of t.segments ?? []) {
      const len = seg.receives?.length ?? 0
      if (len > 1) {
        turnCount += 1
        swipeRemoveTotal += len - 1
      }
    }
  }
  return { turnCount, swipeRemoveTotal }
}

async function patchWithCheck(
  ctx: SwipeBatchCtx,
  dtos: PruneTurnDto[],
): Promise<void> {
  const result = await ctx.patchTurns(dtos)
  if (result.failed?.length) {
    const first = result.failed[0]
    throw new Error(first?.error ?? 'patch_failed')
  }
}

async function cleanTurn(
  host: SwipeCleanerHost,
  turn: SwipeTurn,
  segmentIndex: number,
): Promise<void> {
  const dto = turnItemToDto(turn, segmentIndex)
  const pruned = pruneDto(dto)
  if (!pruned) return
  await host.conversation.runBatch(async (ctx) => {
    await patchWithCheck(ctx, [pruned])
  })
  await host.conversation.refresh()
}

async function cleanAllConversation(host: SwipeCleanerHost): Promise<void> {
  const patches: PruneTurnDto[] = []
  for (const turn of host.session.turns ?? []) {
    const segCount = turn.segments?.length ?? 0
    for (let segIdx = 0; segIdx < segCount; segIdx++) {
      const dto = turnItemToDto(turn, segIdx)
      const pruned = pruneDto(dto)
      if (pruned) patches.push(pruned)
    }
  }
  if (patches.length === 0) return
  for (let i = 0; i < patches.length; i += BATCH_MAX) {
    const chunk = patches.slice(i, i + BATCH_MAX)
    await host.conversation.runBatch(async (ctx) => {
      await patchWithCheck(ctx, chunk)
    })
  }
  await host.conversation.refresh()
}

export function register(host: SwipeCleanerHost): void {
  const k = (key: string) => host.pluginKey(key)

  host.registerSlotButton('assistant-turn-footer', {
    id: `${PLUGIN_ID}-turn`,
    icon: 'mdi-broom',
    tooltipKey: k('tooltip'),
    when: (ctx: SwipeSlotCtx) =>
      !!ctx.turn && segmentSwipeCount(ctx.turn, ctx.segmentIndex) > 1,
    disabled: () => isBusy(host),
    onClick: async (ctx: SwipeSlotCtx) => {
      const turn = ctx.turn
      const segIdx = ctx.segmentIndex ?? getActiveSegmentIndex(turn ?? {})
      if (!turn || segmentSwipeCount(turn, segIdx) <= 1) return
      const receives = getSegmentReceives(turn, segIdx)
      const nRemove = receives.length - 1
      const current = getActiveReceiveIndex(turn, segIdx) + 1
      const total = receives.length
      const ok = await host.ui.confirm({
        title: host.t(k('confirmTurnTitle')),
        body: host.t(k('confirmTurnBody'), { nRemove, current, total }),
        confirmLabel: host.t(k('confirmOk')),
        cancelLabel: host.t(k('confirmCancel')),
        confirmColor: 'error',
      })
      if (!ok) return
      try {
        await cleanTurn(host, turn, segIdx)
        host.ui.notify(host.t(k('notifyTurnDone')), undefined, { level: 'success' })
      } catch (e) {
        console.warn('[swipe-cleaner] turn clean failed', e)
        host.ui.notify(host.t(k('notifyFailed')), undefined, { level: 'error' })
      }
    },
  })

  host.registerSlotButton('composer-toolbar', {
    id: `${PLUGIN_ID}-all`,
    icon: 'mdi-broom',
    tooltipKey: k('tooltipAll'),
    when: () => conversationHasSwipes(host),
    disabled: () => isBusy(host),
    onClick: async () => {
      const { turnCount, swipeRemoveTotal } = summarizeConversation(host)
      if (turnCount === 0) return
      const ok = await host.ui.confirm({
        title: host.t(k('confirmAllTitle')),
        body: host.t(k('confirmAllBody'), { turnCount, swipeRemoveTotal }),
        confirmLabel: host.t(k('confirmOk')),
        cancelLabel: host.t(k('confirmCancel')),
        confirmColor: 'error',
      })
      if (!ok) return
      try {
        await cleanAllConversation(host)
        host.ui.notify(host.t(k('notifyAllDone')), undefined, { level: 'success' })
      } catch (e) {
        console.warn('[swipe-cleaner] all clean failed', e)
        host.ui.notify(host.t(k('notifyFailed')), undefined, { level: 'error' })
      }
    },
  })
}
