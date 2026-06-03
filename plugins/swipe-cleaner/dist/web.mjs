const PLUGIN_ID = 'swipe-cleaner'
const BATCH_MAX = 50

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

function turnItemToDto(turn) {
  return {
    turnOrdinal: turn.turnOrdinal,
    user: turn.user,
    receives: turn.receives.map((r) => ({
      id: r.id,
      content: r.content,
      ...(r.reasoning ? { reasoning: r.reasoning } : {}),
      ...(r.durationMs ? { durationMs: r.durationMs } : {}),
      ...(r.estimatedTokens ? { estimatedTokens: r.estimatedTokens } : {}),
      ...(r.completionTokens ? { completionTokens: r.completionTokens } : {}),
      ...(r.model ? { model: r.model } : {}),
    })),
    activeReceiveIndex: turn.activeReceiveIndex,
  }
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
  return turns.some((t) => (t.receives?.length ?? 0) > 1)
}

function summarizeConversation(host) {
  let turnCount = 0
  let swipeRemoveTotal = 0
  for (const t of host.session.turns ?? []) {
    const len = t.receives?.length ?? 0
    if (len > 1) {
      turnCount += 1
      swipeRemoveTotal += len - 1
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

async function cleanTurn(host, turn) {
  const dto = turnItemToDto(turn)
  const pruned = pruneDto(dto)
  if (!pruned) return
  await host.conversation.runBatch(async (ctx) => {
    await patchWithCheck(host, ctx, [pruned])
  })
  await host.conversation.refresh()
}

async function cleanAllConversation(host) {
  const maxOrd = maxTurnOrdinal(host)
  await host.conversation.runBatch(async (ctx) => {
    for (let from = 0; from <= maxOrd; from += BATCH_MAX) {
      const to = Math.min(from + BATCH_MAX - 1, maxOrd)
      const batch = await ctx.read({ range: { from, to } })
      const changed = []
      for (const turn of batch) {
        const pruned = pruneDto(turn)
        if (pruned) changed.push(pruned)
      }
      if (changed.length) {
        await patchWithCheck(host, ctx, changed)
      }
    }
  })
  await host.conversation.refresh()
}

export function register(host) {
  const k = (key) => host.pluginKey(key)

  host.registerSlotButton('assistant-turn-footer', {
    id: `${PLUGIN_ID}-turn`,
    icon: 'mdi-broom',
    tooltipKey: k('tooltip'),
    when: (ctx) => (ctx.turn?.receives.length ?? 0) > 1,
    disabled: () => isBusy(host),
    onClick: async (ctx) => {
      const turn = ctx.turn
      if (!turn || turn.receives.length <= 1) return
      const nRemove = turn.receives.length - 1
      const current = turn.activeReceiveIndex + 1
      const total = turn.receives.length
      const ok = await host.ui.confirm({
        title: host.t(k('confirmTurnTitle')),
        body: host.t(k('confirmTurnBody'), { nRemove, current, total }),
        confirmLabel: host.t(k('confirmOk')),
        cancelLabel: host.t(k('confirmCancel')),
        confirmColor: 'error',
      })
      if (!ok) return
      try {
        await cleanTurn(host, turn)
        host.ui.toast(host.t(k('toastTurnDone')), { color: 'success' })
      } catch (e) {
        console.warn('[swipe-cleaner] turn clean failed', e)
        host.ui.toast(host.t(k('toastFailed')), { color: 'error' })
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
        host.ui.toast(host.t(k('toastAllDone')), { color: 'success' })
      } catch (e) {
        console.warn('[swipe-cleaner] all clean failed', e)
        host.ui.toast(host.t(k('toastFailed')), { color: 'error' })
      }
    },
  })
}
