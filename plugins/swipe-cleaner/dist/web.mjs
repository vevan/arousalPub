const PLUGIN_ID = 'swipe-cleaner'
const BATCH_MAX = 50

function getActiveSegmentIndex(turn) {
  const segments = turn.segments ?? []
  if (segments.length === 0) return 0
  const raw = turn.activeSegmentIndex ?? 0
  return Math.min(Math.max(0, raw), segments.length - 1)
}

function getSegmentReceives(turn, segmentIndex) {
  const segments = turn.segments ?? []
  if (segments.length === 0) return []
  const idx =
    typeof segmentIndex === 'number' && Number.isFinite(segmentIndex)
      ? segmentIndex
      : getActiveSegmentIndex(turn)
  return segments[idx]?.receives ?? []
}

function getActiveReceiveIndex(turn, segmentIndex) {
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

function pruneDto(turn) {
  if (!turn?.receives || turn.receives.length <= 1) return null
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

function turnItemToDto(turn, segmentIndex) {
  const receives = getSegmentReceives(turn, segmentIndex)
  return {
    turnOrdinal: turn.turnOrdinal,
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

function segmentSwipeCount(turn, segmentIndex) {
  return getSegmentReceives(turn, segmentIndex).length
}

function isBusy(host) {
  return (
    host.session.conversationWriteLocked ||
    host.session.loading ||
    host.session.regeneratingTurnOrdinal !== null
  )
}

function conversationHasSwipes(host) {
  const turns = host.session.turns
  if (!Array.isArray(turns)) return false
  return turns.some((t) =>
    (t.segments ?? []).some((seg) => (seg.receives?.length ?? 0) > 1),
  )
}

function summarizeConversation(host) {
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

function maxTurnOrdinal(host) {
  let max = 0
  for (const t of host.session.turns ?? []) {
    if (typeof t.turnOrdinal === 'number' && t.turnOrdinal > max) {
      max = t.turnOrdinal
    }
  }
  return max
}

async function patchWithCheck(host, ctx, dtos) {
  const result = await ctx.patchTurns(dtos)
  if (result.failed?.length) {
    const first = result.failed[0]
    throw new Error(first?.error ?? 'patch_failed')
  }
}

async function cleanTurn(host, turn, segmentIndex) {
  const dto = turnItemToDto(turn, segmentIndex)
  const pruned = pruneDto(dto)
  if (!pruned) return
  await host.conversation.runBatch(async (ctx) => {
    await patchWithCheck(host, ctx, [pruned])
  })
  await host.conversation.refresh()
}

async function cleanAllConversation(host) {
  const patches = []
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
      await patchWithCheck(host, ctx, chunk)
    })
  }
  await host.conversation.refresh()
}

export function register(host) {
  const k = (key) => host.pluginKey(key)

  host.registerSlotButton('assistant-turn-footer', {
    id: `${PLUGIN_ID}-turn`,
    icon: 'mdi-broom',
    tooltipKey: k('tooltip'),
    when: (ctx) =>
      !!ctx.turn && segmentSwipeCount(ctx.turn, ctx.segmentIndex) > 1,
    disabled: () => isBusy(host),
    onClick: async (ctx) => {
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
