import { PLUGIN_ID } from './constants.js'
import {
  resolveTraceBundle,
  trackerEpochFromSettings,
} from './bundle-resolve.js'
import {
  findTracePayloadForTurn,
  renderTracePanelHtml,
  resolveLiveTraceState,
} from './panel-render.js'
import { runSeparateRegenerate } from './separate-regenerate-client.js'
import {
  bumpPanelRevision,
  getPinnedTurnOrdinal,
  k,
  PLACEMENT,
  setPinnedTurnOrdinal,
} from './state.js'
import type { PluginHost, TurnCtx } from './types.js'
import { watch } from 'vue'

type HostTurn = {
  turnOrdinal: number
  activeReceiveIndex?: number
  receives?: { id?: string; content?: string }[]
  plugins?: unknown[]
}

function turnsFromHost(host: PluginHost): HostTurn[] {
  const raw = host.session.turns
  return Array.isArray(raw) ? raw : []
}

function wrapPanelShell(
  host: PluginHost,
  innerHtml: string,
  opts: {
    noData?: boolean
    canRegenerate?: boolean
    regenerating?: boolean
  },
): string {
  const parts: string[] = ['<div class="trace-keeper-shell">']
  if (opts.noData) {
    parts.push(
      `<p class="tk-empty-msg">${escapeHtml(host.t(k(host, 'panelNoData')))}</p>`,
    )
  }
  if (opts.canRegenerate) {
    const label = escapeHtml(host.t(k(host, 'panelRegenerateSeparate')))
    const busy = opts.regenerating ? ' disabled aria-busy="true"' : ''
    parts.push(
      `<button type="button" class="tk-regen-btn" data-tk-action="regenerate-separate"${busy}>${label}</button>`,
    )
  }
  parts.push(innerHtml)
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

let regenerating = false

async function refreshPanel(host: PluginHost): Promise<void> {
  try {
    const [userSettings, convSettings] = await Promise.all([
      host.plugins.getUserSettings(),
      host.conversation.getPluginSettings(),
    ])
    const bundle = resolveTraceBundle({ userSettings, convSettings })
    host.registerStyles(
      `${bundle.stylesheet}\n.trace-keeper-shell .tk-empty-msg{margin:0 0 8px;opacity:.72;font-size:.875rem}.trace-keeper-shell .tk-regen-btn{display:block;margin:0 0 10px;padding:6px 10px;font-size:.8125rem;border-radius:6px;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));background:rgba(var(--v-theme-primary),.08);cursor:pointer}.trace-keeper-shell .tk-regen-btn:disabled{opacity:.55;cursor:wait}`,
    )

    const epoch = trackerEpochFromSettings(convSettings)
    const turns = turnsFromHost(host)
    const pinned = getPinnedTurnOrdinal()
    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : undefined

    let mode: 'live' | 'pinned' = 'live'
    let turnOrdinal: number | undefined
    let data: Record<string, unknown> = bundle.sampleState
    let noData = false
    let canRegenerate = false

    if (pinned !== null) {
      mode = 'pinned'
      turnOrdinal = pinned
      const turn = turns.find((t) => t.turnOrdinal === pinned)
      const hit = findTracePayloadForTurn(turn, epoch)
      if (hit) {
        data = hit.state
      } else {
        noData = true
        data = {}
      }
    } else {
      const live = resolveLiveTraceState(turns, epoch)
      if (live) {
        data = live.state
        turnOrdinal = live.turnOrdinal
      } else if (lastTurn) {
        turnOrdinal = lastTurn.turnOrdinal
        data = bundle.sampleState
        canRegenerate = !findTracePayloadForTurn(lastTurn, epoch)
      }
    }

    const innerHtml =
      noData && pinned !== null
        ? ''
        : renderTracePanelHtml(bundle, data, {
            mode,
            turnOrdinal,
            epoch,
          })

    const html = wrapPanelShell(host, innerHtml, {
      noData: noData && pinned !== null,
      canRegenerate: mode === 'live' && canRegenerate,
      regenerating,
    })

    host.ui.panel.setHtml(PLACEMENT, PLUGIN_ID, html, {
      revision: bumpPanelRevision(),
    })
  } catch (e) {
    console.warn('[trace-keeper] panel refresh failed', e)
  }
}

async function handleRegenerateSeparate(host: PluginHost): Promise<void> {
  if (regenerating) return
  const conversationId = host.conversation.getId?.()
  if (!conversationId) return

  const turns = turnsFromHost(host)
  const lastTurn = turns[turns.length - 1]
  if (!lastTurn) return

  regenerating = true
  void refreshPanel(host)
  try {
    await runSeparateRegenerate(conversationId, lastTurn.turnOrdinal)
    if (host.conversation.refresh) {
      await host.conversation.refresh()
    }
    host.ui.toast?.(host.t(k(host, 'toastRegenerateDone')), { color: 'success' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'regenerate_failed'
    host.ui.toast?.(host.t(k(host, 'toastRegenerateFailed'), { code }), {
      color: 'error',
    })
  } finally {
    regenerating = false
    await refreshPanel(host)
    host.refreshSlotButtons()
  }
}

export function registerPanel(host: PluginHost): void {
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
        void handleRegenerateSeparate(host)
      }
    },
  })
  void refreshPanel(host)
}

export function registerTurnButton(host: PluginHost): void {
  host.registerSlotButton('turn-block-head', {
    id: `${PLUGIN_ID}-view`,
    icon: 'mdi-map-marker-radius-outline',
    tooltipKey: (ctx: TurnCtx) => {
      const ord = ctx.turn?.turnOrdinal
      if (typeof ord !== 'number') return k(host, 'tooltipTurnEmpty')
      const pinned = getPinnedTurnOrdinal()
      const epoch = trackerEpochFromSettings(
        host.conversation.getPluginSettingsSnapshot(),
      )
      const hit = findTracePayloadForTurn(ctx.turn, epoch)
      if (pinned === ord && !hit) return k(host, 'tooltipTurnPinnedEmpty')
      return hit ? k(host, 'tooltipTurnView') : k(host, 'tooltipTurnEmpty')
    },
    disabled: (ctx: TurnCtx) => {
      const ord = ctx.turn?.turnOrdinal
      if (typeof ord !== 'number') return true
      const pinned = getPinnedTurnOrdinal()
      if (pinned === ord) return false
      const epoch = trackerEpochFromSettings(
        host.conversation.getPluginSettingsSnapshot(),
      )
      return !findTracePayloadForTurn(ctx.turn, epoch)
    },
    filled: (ctx: TurnCtx) => {
      const pinned = getPinnedTurnOrdinal()
      const ord = ctx.turn?.turnOrdinal
      return pinned !== null && ord === pinned
    },
    when: (ctx: TurnCtx) =>
      typeof ctx.turn?.turnOrdinal === 'number',
    onClick: (ctx: TurnCtx) => {
      const ord = ctx.turn?.turnOrdinal
      if (typeof ord !== 'number') return
      const pinned = getPinnedTurnOrdinal()
      setPinnedTurnOrdinal(pinned === ord ? null : ord)
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
  host.lifecycle.onAssistantReplyPersisted(() => {
    void (async () => {
      if (host.conversation.refresh) {
        await host.conversation.refresh()
      }
      await refreshPanel(host)
      host.refreshSlotButtons()
    })()
  })
  watch(
    () =>
      turnsFromHost(host).map(
        (t) =>
          `${t.turnOrdinal}:${t.activeReceiveIndex ?? 0}:${t.receives?.length ?? 0}:${JSON.stringify(t.plugins ?? [])}`,
      ),
    () => {
      void refreshPanel(host)
      host.refreshSlotButtons()
    },
  )
}

export function register(host: PluginHost): void {
  registerPanel(host)
  registerTurnButton(host)
  registerLifecycle(host)
}
