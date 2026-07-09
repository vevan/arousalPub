import { PLUGIN_ID } from './constants.js'
import {
  resolveTraceBundle,
  trackerEpochFromSettings,
} from './bundle-resolve.js'
import {
  panelEmptyLocaleKey,
  resolvePanelView,
  type PanelEmptyReason,
} from './panel-empty.js'
import { findTracePayloadForTurn } from './panel-render.js'
import {
  parseStateJsonText,
  runPatchState,
} from './patch-state-client.js'
import { runSeparateRegenerate, SeparateRegenerateError } from './separate-regenerate-client.js'
import { auditDebugEnabled, logSeparateDebugIfPresent } from './audit-debug.js'
import {
  bumpPanelRevision,
  clearPinIfLiveTailAdvanced,
  getPinnedView,
  isRegenerating,
  k,
  PLACEMENT,
  setPinnedView,
  setRegenerating,
  syncActiveConversation,
  type LiveTailSnapshot,
  type PinnedTraceView,
} from './state.js'
import { resolveViewSegmentIndex, type TurnViewRef } from './turn-view-segment.js'
import type { PluginHost, TurnCtx } from './types.js'

const EDIT_DIALOG_ID = 'edit-state-json'

type EditContext = {
  turnOrdinal: number
  segmentIndex: number
  state: Record<string, unknown>
}

function turnsFromHost(host: PluginHost): TurnViewRef[] {
  const raw = host.session.turns as
    | TurnViewRef[]
    | { value?: TurnViewRef[] }
    | undefined
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray(raw.value)) {
    return raw.value
  }
  return []
}

function fullTurnForOrdinal(
  turns: TurnViewRef[],
  turnOrdinal: number,
): TurnViewRef | null {
  return turns.find((t) => t.turnOrdinal === turnOrdinal) ?? null
}

function segmentIndexFromCtx(ctx: TurnCtx): number {
  if (typeof ctx.segmentIndex === 'number' && Number.isFinite(ctx.segmentIndex)) {
    return Math.max(0, Math.floor(ctx.segmentIndex))
  }
  const turn = ctx.turn
  if (!turn) return 0
  return resolveViewSegmentIndex(turn as TurnViewRef)
}

const SHELL_STYLES = `
.trace-keeper-shell{display:flex;flex-direction:column;gap:8px;min-height:2.5rem}
.trace-keeper-shell .tk-empty{margin:0}
.trace-keeper-shell .tk-empty-msg{margin:0 0 4px;opacity:.85;font-size:.875rem}
.trace-keeper-shell .tk-empty-detail{margin:0;font-size:.75rem;opacity:.55;word-break:break-word;overflow-wrap:anywhere}
.trace-keeper-shell .tk-empty-actions{margin:0}
.trace-keeper-shell .tk-empty-regen-btn{padding:6px 10px;font-size:.8125rem;border-radius:6px;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));background:rgba(var(--v-theme-primary),.08);cursor:pointer}
.trace-keeper-shell .tk-empty-regen-btn:disabled{opacity:.55;cursor:wait}
.trace-keeper-shell .tk-pending{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px 12px;text-align:center;min-height:6rem}
.trace-keeper-shell .tk-pending-hourglass{display:inline-block;font-size:3rem;line-height:1;color:rgba(var(--v-theme-primary),.85);transform-origin:center center;animation:tk-hourglass-flip 2.4s ease-in-out infinite}
.trace-keeper-shell .tk-pending-msg{margin:0;font-size:.75rem;line-height:1.4;opacity:.72;max-width:14rem}
@keyframes tk-hourglass-flip{0%{transform:rotate(0deg)}30%{transform:rotate(180deg)}50%{transform:rotate(180deg)}80%{transform:rotate(360deg)}100%{transform:rotate(360deg)}}
.trace-keeper-shell .tk-body{min-width:0}
.trace-keeper-shell .tk-body .trace-keeper-panel,.trace-keeper-shell .tk-body pre{max-width:100%;word-break:break-word;overflow-wrap:anywhere}
.trace-keeper-shell .tk-body pre{overflow-x:auto;white-space:pre-wrap}
.trace-keeper-shell .tk-actions{display:flex;flex-direction:row;align-items:center;gap:2px;flex-shrink:0;padding-top:6px;border-top:1px solid rgba(var(--v-border-color),var(--v-border-opacity))}
.trace-keeper-shell .tk-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:1.75rem;height:1.75rem;padding:0;border:none;border-radius:4px;background:transparent;color:rgba(var(--v-theme-on-surface),.55);cursor:pointer}
.trace-keeper-shell .tk-icon-btn:hover:not(:disabled){color:rgb(var(--v-theme-on-surface));background:rgba(var(--v-theme-on-surface),.06)}
.trace-keeper-shell .tk-icon-btn:disabled{opacity:.35;cursor:not-allowed}
.trace-keeper-shell .tk-icon-btn .mdi{font-size:16px;line-height:1;pointer-events:none}
`

function renderActionBar(
  host: PluginHost,
  opts: {
    showActions: boolean
    editEnabled: boolean
    regenEnabled: boolean
    regenerating?: boolean
    segmentNav?: { segmentIndex: number; segmentCount: number }
  },
): string {
  if (!opts.showActions) return ''
  const editTitle = escapeHtml(host.t(k(host, 'panelFabEditTooltip')))
  const regenTitle = escapeHtml(host.t(k(host, 'panelFabRegenerateTooltip')))
  const editDisabled = opts.editEnabled ? '' : ' disabled'
  const regenDisabled =
    opts.regenEnabled && !opts.regenerating ? '' : ' disabled'
  const regenBusy = opts.regenerating ? ' aria-busy="true"' : ''
  const nav = opts.segmentNav
  const navHtml =
    nav && nav.segmentCount > 1
      ? [
          `<button type="button" class="tk-icon-btn" data-tk-action="segment-prev"${nav.segmentIndex <= 0 ? ' disabled' : ''} title="prev" aria-label="prev"><i class="mdi mdi-chevron-left" aria-hidden="true"></i></button>`,
          `<button type="button" class="tk-icon-btn" data-tk-action="segment-next"${nav.segmentIndex >= nav.segmentCount - 1 ? ' disabled' : ''} title="next" aria-label="next"><i class="mdi mdi-chevron-right" aria-hidden="true"></i></button>`,
        ].join('\n')
      : ''
  return [
    '<div class="tk-actions">',
    navHtml,
    `<button type="button" class="tk-icon-btn" data-tk-action="edit-state-json" title="${editTitle}" aria-label="${editTitle}"${editDisabled}><i class="mdi mdi-pencil-outline" aria-hidden="true"></i></button>`,
    `<button type="button" class="tk-icon-btn" data-tk-action="regenerate-separate" title="${regenTitle}" aria-label="${regenTitle}"${regenDisabled}${regenBusy}><i class="mdi mdi-refresh" aria-hidden="true"></i></button>`,
    '</div>',
  ].join('\n')
}

function wrapPanelShell(
  host: PluginHost,
  innerHtml: string,
  opts: {
    emptyReason?: PanelEmptyReason
    emptyDetail?: string
    showEmptyRegenButton?: boolean
    showActions?: boolean
    editEnabled?: boolean
    regenEnabled?: boolean
    regenerating?: boolean
    segmentNav?: { segmentIndex: number; segmentCount: number }
  },
): string {
  const parts: string[] = ['<div class="trace-keeper-shell">']
  if (opts.emptyReason) {
    if (opts.emptyReason === 'awaiting_reply') {
      const msg = escapeHtml(host.t(k(host, 'panelEmptyAwaitingReply')))
      parts.push('<div class="tk-pending" role="status">')
      parts.push(
        '<i class="mdi mdi-timer-sand tk-pending-hourglass" aria-hidden="true"></i>',
      )
      parts.push(`<p class="tk-pending-msg">${msg}</p>`)
      parts.push('</div>')
    } else {
      const msgKey = panelEmptyLocaleKey(opts.emptyReason)
      parts.push('<div class="tk-empty" role="status">')
      parts.push(
        `<p class="tk-empty-msg">${escapeHtml(host.t(k(host, msgKey)))}</p>`,
      )
      if (opts.emptyDetail?.trim()) {
        parts.push(
          `<p class="tk-empty-detail">${escapeHtml(opts.emptyDetail.trim())}</p>`,
        )
      }
      parts.push('</div>')
      if (opts.showEmptyRegenButton) {
        parts.push('<div class="tk-empty-actions">')
        const label = escapeHtml(host.t(k(host, 'panelRegenerateSeparate')))
        const busy = opts.regenerating ? ' disabled aria-busy="true"' : ''
        parts.push(
          `<button type="button" class="tk-empty-regen-btn" data-tk-action="regenerate-separate"${busy}>${label}</button>`,
        )
        parts.push('</div>')
      }
    }
  }
  if (innerHtml.trim()) {
    parts.push(`<div class="tk-body">${innerHtml}</div>`)
  }
  parts.push(
    renderActionBar(host, {
      showActions: opts.showActions === true,
      editEnabled: opts.editEnabled === true,
      regenEnabled: opts.regenEnabled === true,
      regenerating: opts.regenerating,
      segmentNav: opts.segmentNav,
    }),
  )
  parts.push('</div>')
  return parts.join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

let lastEditContext: EditContext | null = null
let lastLiveContext: { turnOrdinal: number; segmentIndex: number } | null = null

function conversationIdFrom(host: PluginHost): string {
  return host.conversation.getId?.()?.trim() ?? ''
}

type TkNotifyLevel = 'info' | 'success' | 'warning' | 'error'

function tkNotify(
  host: PluginHost,
  messageKey: string,
  level: TkNotifyLevel,
  params?: Record<string, unknown>,
): void {
  host.ui.notify(host.t(k(host, messageKey), params), undefined, { level })
}

function segmentCountForTurn(turn: TurnViewRef | null | undefined): number {
  return turn?.segments?.length ?? 0
}

function fingerprintTurnTail(turn: TurnViewRef): string {
  const segs = turn.segments ?? []
  return segs
    .map((seg) => {
      const rs = seg.receives ?? []
      const ai = Math.min(
        Math.max(0, Math.floor(seg.activeReceiveIndex ?? 0)),
        Math.max(0, rs.length - 1),
      )
      const rec = rs[ai]
      const id = rec?.id?.trim() ?? ''
      const len = typeof rec?.content === 'string' ? rec.content.length : 0
      return `${id}:${len}:${rs.length}:${ai}`
    })
    .join('|')
}

function liveTailSnapshotFromTurns(
  turns: TurnViewRef[],
): LiveTailSnapshot | null {
  const last = turns[turns.length - 1]
  if (!last) return null
  return {
    turnOrdinal: last.turnOrdinal,
    segmentIndex: resolveViewSegmentIndex(last),
    fingerprint: fingerprintTurnTail(last),
  }
}

async function refreshPanel(host: PluginHost): Promise<void> {
  try {
    const [userSettings, convSettings] = await Promise.all([
      host.plugins.getUserSettings(),
      host.conversation.getPluginSettings(),
    ])
    const bundle = resolveTraceBundle({ userSettings, convSettings })
    host.registerStyles(`${bundle.stylesheet}\n${SHELL_STYLES}`)

    const epoch = trackerEpochFromSettings(convSettings)
    const turns = turnsFromHost(host)
    const conversationId = conversationIdFrom(host)
    const conversationSwitched = syncActiveConversation(conversationId)
    const pinClearedByNewReply = clearPinIfLiveTailAdvanced(
      conversationId,
      liveTailSnapshotFromTurns(turns),
    )
    const pinned = getPinnedView(conversationId)
    const regenBusy = isRegenerating(conversationId)

    const resolved = resolvePanelView(
      bundle,
      turns,
      epoch,
      pinned,
      regenBusy,
    )

    const viewingSegmentIndex =
      resolved.kind === 'content'
        ? resolved.segmentIndex
        : resolved.segmentIndex ?? 0
    const viewingOrdinal =
      resolved.kind === 'content'
        ? resolved.turnOrdinal
        : resolved.turnOrdinal

    lastEditContext =
      resolved.kind === 'content' && !resolved.actionsDisabled
        ? {
            turnOrdinal: resolved.turnOrdinal,
            segmentIndex: resolved.segmentIndex,
            state: resolved.editState,
          }
        : null

    const lastTurn = turns.length > 0 ? turns[turns.length - 1]! : null
    const isLastTurnView =
      lastTurn !== null &&
      typeof viewingOrdinal === 'number' &&
      viewingOrdinal === lastTurn.turnOrdinal
    const liveSegmentIndex = lastTurn ? resolveViewSegmentIndex(lastTurn) : 0
    lastLiveContext =
      lastTurn != null
        ? { turnOrdinal: lastTurn.turnOrdinal, segmentIndex: liveSegmentIndex }
        : null

    const actionsDisabled =
      resolved.kind === 'content' && resolved.actionsDisabled === true
    const viewingTurn =
      typeof viewingOrdinal === 'number'
        ? fullTurnForOrdinal(turns, viewingOrdinal)
        : null
    const segmentNav =
      pinned && viewingTurn
        ? {
            segmentIndex: viewingSegmentIndex,
            segmentCount: segmentCountForTurn(viewingTurn),
          }
        : undefined

    const shellActions = {
      showActions: turns.length > 0,
      editEnabled: resolved.kind === 'content' && !actionsDisabled,
      regenEnabled:
        !actionsDisabled &&
        isLastTurnView &&
        viewingSegmentIndex === liveSegmentIndex &&
        (resolved.kind === 'content' ||
          (resolved.kind === 'empty' && resolved.canRegenerate)),
      regenerating: regenBusy,
      segmentNav,
    }

    const html =
      resolved.kind === 'content'
        ? wrapPanelShell(host, resolved.html, shellActions)
        : wrapPanelShell(host, '', {
            emptyReason: resolved.reason,
            emptyDetail: resolved.detail,
            showEmptyRegenButton: resolved.canRegenerate,
            ...shellActions,
          })

    host.ui.panel.setHtml(PLACEMENT, PLUGIN_ID, html, {
      revision: bumpPanelRevision(),
    })
    if (conversationSwitched || pinClearedByNewReply) {
      host.refreshSlotButtons()
    }
  } catch (e) {
    console.warn('[trace-keeper] panel refresh failed', e)
  }
}

function openEditStateDialog(host: PluginHost): void {
  if (!lastEditContext || !host.openFormDialog) {
    tkNotify(host, 'notifyEditNoState', 'warning')
    return
  }
  host.openFormDialog(
    PLUGIN_ID,
    {
      turnOrdinal: lastEditContext.turnOrdinal,
      segmentIndex: lastEditContext.segmentIndex,
      stateJson: JSON.stringify(lastEditContext.state, null, 2),
    },
    EDIT_DIALOG_ID,
  )
}

function shiftPinnedSegment(host: PluginHost, delta: number): void {
  const conversationId = conversationIdFrom(host)
  const pinned = getPinnedView(conversationId)
  if (!pinned) return
  const turn = fullTurnForOrdinal(turnsFromHost(host), pinned.turnOrdinal)
  const count = segmentCountForTurn(turn)
  if (count <= 1) return
  const next = Math.min(
    Math.max(0, pinned.segmentIndex + delta),
    count - 1,
  )
  if (next === pinned.segmentIndex) return
  setPinnedView(conversationId, { ...pinned, segmentIndex: next })
  void refreshPanel(host)
  host.refreshSlotButtons()
}

async function handlePatchStateSubmit(
  host: PluginHost,
  model: Record<string, unknown>,
): Promise<void> {
  const conversationId = host.conversation.getId?.()
  const turnOrdinal = model.turnOrdinal
  const segmentIndex = model.segmentIndex
  const stateJson = String(model.stateJson ?? '')
  if (!conversationId || typeof turnOrdinal !== 'number') return

  const state = parseStateJsonText(stateJson)
  if (!state) {
    tkNotify(host, 'notifyPatchInvalidJson', 'warning')
    return
  }

  try {
    await runPatchState(host, conversationId, turnOrdinal, state, {
      segmentIndex:
        typeof segmentIndex === 'number' ? Math.round(segmentIndex) : undefined,
    })
    if (host.conversation.refresh) {
      await host.conversation.refresh()
    }
    await refreshPanel(host)
    host.refreshSlotButtons()
    tkNotify(host, 'notifyPatchDone', 'success')
  } catch (e) {
    const code = e instanceof Error ? e.message : 'patch_failed'
    tkNotify(host, 'notifyPatchFailed', 'error', { code })
  }
}

async function handleRegenerateSeparate(
  host: PluginHost,
  segmentIndex?: number,
): Promise<void> {
  const conversationId = conversationIdFrom(host)
  if (!conversationId || isRegenerating(conversationId)) return

  const turns = turnsFromHost(host)
  const lastTurn = turns[turns.length - 1]
  if (!lastTurn) return

  const segIdx =
    typeof segmentIndex === 'number'
      ? segmentIndex
      : resolveViewSegmentIndex(lastTurn)

  setRegenerating(conversationId, true)
  void refreshPanel(host)
  const wantDebug = auditDebugEnabled(host)
  try {
    const result = await runSeparateRegenerate(
      host,
      conversationId,
      lastTurn.turnOrdinal,
      { segmentIndex: segIdx },
    )
    logSeparateDebugIfPresent(result.debug)
    if (wantDebug && !result.debug) {
      console.warn(
        '[trace-keeper] 已请求 debug 但响应无 debug 字段；请重启服务端并确认 Separate 路由已更新',
      )
    }
    if (host.conversation.refresh) {
      await host.conversation.refresh()
    }
    tkNotify(host, 'notifyRegenerateDone', 'success')
  } catch (e) {
    if (e instanceof SeparateRegenerateError) {
      logSeparateDebugIfPresent(e.debug)
      if (wantDebug && !e.debug) {
        console.warn(
          '[trace-keeper] 已请求 debug 但错误响应无 debug 字段；请重启服务端并确认 Separate 路由已更新',
        )
      }
      tkNotify(host, 'notifyRegenerateFailed', 'error', { code: e.code })
    } else if (e instanceof Error) {
      tkNotify(host, 'notifyRegenerateFailed', 'error', { code: e.message })
    }
  } finally {
    setRegenerating(conversationId, false)
    await refreshPanel(host)
    host.refreshSlotButtons()
  }
}

function registerEditStateDialog(host: PluginHost): void {
  if (!host.registerFormDialog) return
  host.registerFormDialog(
    PLUGIN_ID,
    {
      titleKey: k(host, 'editStateDialogTitle'),
      fields: [
        {
          key: 'stateJson',
          labelKey: k(host, 'editStateJsonLabel'),
          type: 'textarea',
        },
      ],
      submitKey: k(host, 'editStateSave'),
      cancelKey: k(host, 'editStateCancel'),
      canSubmit: (model) => parseStateJsonText(String(model.stateJson ?? '')) !== null,
      onSubmit: async (hostApi, model) => {
        await handlePatchStateSubmit(hostApi as PluginHost, model)
      },
    },
    EDIT_DIALOG_ID,
  )
}

export function registerPanel(host: PluginHost): void {
  registerEditStateDialog(host)
  host.ui.panel.register({
    placement: PLACEMENT,
    pluginId: PLUGIN_ID,
    tabIcon: 'mdi-map-marker-radius-outline',
    tabLabelKey: k(host, 'tabLabel'),
    interactive: true,
  })
  host.ui.panel.onEvent(PLACEMENT, PLUGIN_ID, {
    onAction: (ev) => {
      if (ev.action === 'regenerate-separate') {
        void handleRegenerateSeparate(host, lastLiveContext?.segmentIndex)
      }
      if (ev.action === 'edit-state-json') {
        openEditStateDialog(host)
      }
      if (ev.action === 'segment-prev') {
        shiftPinnedSegment(host, -1)
      }
      if (ev.action === 'segment-next') {
        shiftPinnedSegment(host, 1)
      }
    },
  })
  void refreshPanel(host)
}

function pinnedMatches(ctx: TurnCtx, pinned: PinnedTraceView | null): boolean {
  if (!pinned) return false
  const ord = ctx.turn?.turnOrdinal
  if (typeof ord !== 'number' || ord !== pinned.turnOrdinal) return false
  return segmentIndexFromCtx(ctx) === pinned.segmentIndex
}

export function registerTurnButton(host: PluginHost): void {
  host.registerSlotButton('assistant-turn', {
    id: `${PLUGIN_ID}-view`,
    order: -100,
    icon: 'mdi-map-marker-radius-outline',
    tooltipKey: (ctx: TurnCtx) => {
      const ord = ctx.turn?.turnOrdinal
      if (typeof ord !== 'number') return k(host, 'tooltipTurnEmpty')
      const conversationId = conversationIdFrom(host)
      const pinned = getPinnedView(conversationId)
      const segIdx = segmentIndexFromCtx(ctx)
      const epoch = trackerEpochFromSettings(
        host.conversation.getPluginSettingsSnapshot(),
      )
      const hit = findTracePayloadForTurn(ctx.turn as TurnViewRef, epoch, segIdx)
      if (pinnedMatches(ctx, pinned) && !hit) return k(host, 'tooltipTurnPinnedEmpty')
      return hit ? k(host, 'tooltipTurnView') : k(host, 'tooltipTurnEmpty')
    },
    disabled: (ctx: TurnCtx) => {
      const ord = ctx.turn?.turnOrdinal
      if (typeof ord !== 'number') return true
      const conversationId = conversationIdFrom(host)
      if (pinnedMatches(ctx, getPinnedView(conversationId))) return false
      const epoch = trackerEpochFromSettings(
        host.conversation.getPluginSettingsSnapshot(),
      )
      return !findTracePayloadForTurn(
        ctx.turn as TurnViewRef,
        epoch,
        segmentIndexFromCtx(ctx),
      )
    },
    filled: (ctx: TurnCtx) => pinnedMatches(ctx, getPinnedView(conversationIdFrom(host))),
    when: (ctx: TurnCtx) => typeof ctx.turn?.turnOrdinal === 'number',
    onClick: (ctx: TurnCtx) => {
      const ord = ctx.turn?.turnOrdinal
      if (typeof ord !== 'number') return
      const conversationId = conversationIdFrom(host)
      const segIdx = segmentIndexFromCtx(ctx)
      const pinned = getPinnedView(conversationId)
      const next: PinnedTraceView | null =
        pinned?.turnOrdinal === ord && pinned.segmentIndex === segIdx
          ? null
          : { turnOrdinal: ord, segmentIndex: segIdx }
      setPinnedView(conversationId, next)
      host.refreshSlotButtons()
      void refreshPanel(host)
      host.ui.panel.open(PLACEMENT, PLUGIN_ID)
    },
  })
}

export function registerLifecycle(host: PluginHost): void {
  host.conversation.onPluginSettingsChanged(() => {
    void refreshPanel(host)
    host.refreshSlotButtons()
  })
  host.plugins.onUserSettingsChanged?.(() => {
    void refreshPanel(host)
    host.refreshSlotButtons()
  })
  host.lifecycle.onTurnDataChanged?.(() => {
    void refreshPanel(host)
    host.refreshSlotButtons()
  })
  host.lifecycle.onGeneratingChanged?.(() => {
    void refreshPanel(host)
  })
}

export function register(host: PluginHost): void {
  registerPanel(host)
  registerTurnButton(host)
  registerLifecycle(host)
}
