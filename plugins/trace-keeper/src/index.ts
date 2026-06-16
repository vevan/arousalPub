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

const EDIT_DIALOG_ID = 'edit-state-json'

type HostTurn = {
  turnOrdinal: number
  activeReceiveIndex?: number
  receives?: { id?: string; content?: string }[]
  plugins?: unknown[]
}

type EditContext = {
  turnOrdinal: number
  state: Record<string, unknown>
}

function turnsFromHost(host: PluginHost): HostTurn[] {
  const raw = host.session.turns
  return Array.isArray(raw) ? raw : []
}

const SHELL_STYLES = `
.trace-keeper-shell .tk-empty{margin:0 0 10px}
.trace-keeper-shell .tk-empty-msg{margin:0 0 4px;opacity:.85;font-size:.875rem}
.trace-keeper-shell .tk-empty-detail{margin:0;font-size:.75rem;opacity:.55;word-break:break-word}
.trace-keeper-shell .tk-actions{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.trace-keeper-shell .tk-regen-btn,.trace-keeper-shell .tk-edit-btn{padding:6px 10px;font-size:.8125rem;border-radius:6px;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));background:rgba(var(--v-theme-primary),.08);cursor:pointer}
.trace-keeper-shell .tk-regen-btn:disabled,.trace-keeper-shell .tk-edit-btn:disabled{opacity:.55;cursor:wait}
`

function wrapPanelShell(
  host: PluginHost,
  innerHtml: string,
  opts: {
    emptyReason?: PanelEmptyReason
    emptyDetail?: string
    canRegenerate?: boolean
    canEdit?: boolean
    regenerating?: boolean
  },
): string {
  const parts: string[] = ['<div class="trace-keeper-shell">']
  if (opts.emptyReason) {
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
  }
  if (opts.canRegenerate || opts.canEdit) {
    parts.push('<div class="tk-actions">')
    if (opts.canEdit) {
      const label = escapeHtml(host.t(k(host, 'panelEditStateJson')))
      parts.push(
        `<button type="button" class="tk-edit-btn" data-tk-action="edit-state-json">${label}</button>`,
      )
    }
    if (opts.canRegenerate) {
      const label = escapeHtml(host.t(k(host, 'panelRegenerateSeparate')))
      const busy = opts.regenerating ? ' disabled aria-busy="true"' : ''
      parts.push(
        `<button type="button" class="tk-regen-btn" data-tk-action="regenerate-separate"${busy}>${label}</button>`,
      )
    }
    parts.push('</div>')
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
let lastEditContext: EditContext | null = null

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
    const pinned = getPinnedTurnOrdinal()

    const resolved = resolvePanelView(bundle, turns, epoch, pinned)

    lastEditContext =
      resolved.kind === 'content'
        ? {
            turnOrdinal: resolved.turnOrdinal,
            state: resolved.editState,
          }
        : null

    const html =
      resolved.kind === 'content'
        ? wrapPanelShell(host, resolved.html, {
            canEdit: true,
            regenerating,
          })
        : wrapPanelShell(host, '', {
            emptyReason: resolved.reason,
            emptyDetail: resolved.detail,
            canRegenerate: resolved.canRegenerate,
            regenerating,
          })

    host.ui.panel.setHtml(PLACEMENT, PLUGIN_ID, html, {
      revision: bumpPanelRevision(),
    })
  } catch (e) {
    console.warn('[trace-keeper] panel refresh failed', e)
  }
}

function openEditStateDialog(host: PluginHost): void {
  if (!lastEditContext || !host.openFormDialog) return
  host.openFormDialog(
    PLUGIN_ID,
    {
      turnOrdinal: lastEditContext.turnOrdinal,
      stateJson: JSON.stringify(lastEditContext.state, null, 2),
    },
    EDIT_DIALOG_ID,
  )
}

async function handlePatchStateSubmit(
  host: PluginHost,
  model: Record<string, unknown>,
): Promise<void> {
  const conversationId = host.conversation.getId?.()
  const turnOrdinal = model.turnOrdinal
  const stateJson = String(model.stateJson ?? '')
  if (!conversationId || typeof turnOrdinal !== 'number') return

  const state = parseStateJsonText(stateJson)
  if (!state) {
    host.ui.toast?.(host.t(k(host, 'toastPatchInvalidJson')), { color: 'error' })
    return
  }

  try {
    await runPatchState(conversationId, turnOrdinal, state)
    if (host.conversation.refresh) {
      await host.conversation.refresh()
    }
    host.ui.toast?.(host.t(k(host, 'toastPatchDone')), { color: 'success' })
    await refreshPanel(host)
    host.refreshSlotButtons()
  } catch (e) {
    const code = e instanceof Error ? e.message : 'patch_failed'
    host.ui.toast?.(host.t(k(host, 'toastPatchFailed'), { code }), {
      color: 'error',
    })
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
        void handleRegenerateSeparate(host)
      }
      if (ev.action === 'edit-state-json') {
        openEditStateDialog(host)
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
          `${t.turnOrdinal}:${t.activeReceiveIndex ?? 0}:${t.receives?.map((r) => r.content?.length ?? 0).join(',') ?? ''}:${JSON.stringify(t.plugins ?? [])}`,
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
