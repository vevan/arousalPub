import { PLUGIN_ID } from './constants.js'
import {
  resolveTraceBundle,
  trackerEpochFromSettings,
} from './bundle-resolve.js'
import {
  findTracePayloadInTurnPlugins,
  renderTracePanelHtml,
  resolveLiveTraceState,
} from './panel-render.js'
import {
  bumpPanelRevision,
  getPinnedTurnOrdinal,
  k,
  PLACEMENT,
  setPinnedTurnOrdinal,
} from './state.js'
import type { PluginHost, TurnCtx } from './types.js'

function turnsFromHost(host: PluginHost): { turnOrdinal: number; plugins?: unknown[] }[] {
  const raw = host.session.turns
  return Array.isArray(raw) ? raw : []
}

async function refreshPanel(host: PluginHost): Promise<void> {
  try {
    const [userSettings, convSettings] = await Promise.all([
      host.plugins.getUserSettings(),
      host.conversation.getPluginSettings(),
    ])
    const bundle = resolveTraceBundle({ userSettings, convSettings })
    host.registerStyles(bundle.stylesheet)

    const epoch = trackerEpochFromSettings(convSettings)
    const turns = turnsFromHost(host)
    const pinned = getPinnedTurnOrdinal()

    let data = bundle.sampleState
    let mode: 'live' | 'pinned' = 'live'
    let turnOrdinal: number | undefined

    if (pinned !== null) {
      const turn = turns.find((t) => t.turnOrdinal === pinned)
      const hit = findTracePayloadInTurnPlugins(turn?.plugins, epoch)
      if (hit) {
        data = hit.state
        mode = 'pinned'
        turnOrdinal = pinned
      }
    }

    if (mode === 'live') {
      const live = resolveLiveTraceState(turns, epoch)
      if (live) {
        data = live.state
        turnOrdinal = live.turnOrdinal
      } else {
        data = bundle.sampleState
      }
    }

    const html = renderTracePanelHtml(bundle, data, {
      mode,
      turnOrdinal,
      epoch,
    })
    host.ui.panel.setHtml(PLACEMENT, PLUGIN_ID, html, {
      revision: bumpPanelRevision(),
    })
  } catch (e) {
    console.warn('[trace-keeper] panel refresh failed', e)
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
  void refreshPanel(host)
}

export function registerTurnButton(host: PluginHost): void {
  host.registerSlotButton('turn-block-head', {
    id: `${PLUGIN_ID}-view`,
    icon: 'mdi-map-marker-radius-outline',
    tooltipKey: (ctx: TurnCtx) => {
      const ord = ctx.turn?.turnOrdinal
      if (typeof ord !== 'number') return k(host, 'tooltipTurnEmpty')
      const epoch = trackerEpochFromSettings(
        host.conversation.getPluginSettingsSnapshot(),
      )
      const hit = findTracePayloadInTurnPlugins(ctx.turn?.plugins, epoch)
      return hit ? k(host, 'tooltipTurnView') : k(host, 'tooltipTurnEmpty')
    },
    disabled: (ctx: TurnCtx) => {
      const epoch = trackerEpochFromSettings(
        host.conversation.getPluginSettingsSnapshot(),
      )
      return !findTracePayloadInTurnPlugins(ctx.turn?.plugins, epoch)
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
}

export function register(host: PluginHost): void {
  registerPanel(host)
  registerTurnButton(host)
  registerLifecycle(host)
}
