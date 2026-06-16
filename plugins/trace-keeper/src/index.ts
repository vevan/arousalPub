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
  getPinnedTurnOrdinal,
  k,
  PLACEMENT,
  setPinnedTurnOrdinal,
} from './state.js'
import type { PluginHost, TurnCtx } from './types.js'

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
  const raw = host.session.turns as
    | HostTurn[]
    | { value?: HostTurn[] }
    | undefined
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray(raw.value)) {
    return raw.value
  }
  return []
}

const SHELL_STYLES = `
.trace-keeper-shell{display:flex;flex-direction:column;gap:8px;min-height:2.5rem}
.trace-keeper-shell .tk-empty{margin:0}
.trace-keeper-shell .tk-empty-msg{margin:0 0 4px;opacity:.85;font-size:.875rem}
.trace-keeper-shell .tk-empty-detail{margin:0;font-size:.75rem;opacity:.55;word-break:break-word}
.trace-keeper-shell .tk-empty-actions{margin:0}
.trace-keeper-shell .tk-empty-regen-btn{padding:6px 10px;font-size:.8125rem;border-radius:6px;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));background:rgba(var(--v-theme-primary),.08);cursor:pointer}
.trace-keeper-shell .tk-empty-regen-btn:disabled{opacity:.55;cursor:wait}
.trace-keeper-shell .tk-body{flex:1 1 auto;min-height:0}
.trace-keeper-shell .tk-actions{display:flex;flex-direction:row;align-items:center;gap:2px;flex-shrink:0;padding-top:6px;border-top:1px solid rgba(var(--v-border-color),var(--v-border-opacity))}
.trace-keeper-shell .tk-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:1.75rem;height:1.75rem;padding:0;border:none;border-radius:4px;background:transparent;color:rgba(var(--v-theme-on-surface),.55);cursor:pointer}
.trace-keeper-shell .tk-icon-btn:hover:not(:disabled){color:rgb(var(--v-theme-on-surface));background:rgba(var(--v-theme-on-surface),.06)}
.trace-keeper-shell .tk-icon-btn:disabled{opacity:.35;cursor:not-allowed}
.trace-keeper-shell .tk-icon-btn svg{width:16px;height:16px;fill:currentColor;display:block;pointer-events:none}
`

const ICON_EDIT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg>`
const ICON_REGEN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08a5.99 5.99 0 0 1-5.65 4c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`

function renderActionBar(
  host: PluginHost,
  opts: {
    showActions: boolean
    editEnabled: boolean
    regenEnabled: boolean
    regenerating?: boolean
  },
): string {
  if (!opts.showActions) return ''
  const editTitle = escapeHtml(host.t(k(host, 'panelFabEditTooltip')))
  const regenTitle = escapeHtml(host.t(k(host, 'panelFabRegenerateTooltip')))
  const editDisabled = opts.editEnabled ? '' : ' disabled'
  const regenDisabled =
    opts.regenEnabled && !opts.regenerating ? '' : ' disabled'
  const regenBusy = opts.regenerating ? ' aria-busy="true"' : ''
  return [
    '<div class="tk-actions">',
    `<button type="button" class="tk-icon-btn" data-tk-action="edit-state-json" title="${editTitle}" aria-label="${editTitle}"${editDisabled}>${ICON_EDIT}</button>`,
    `<button type="button" class="tk-icon-btn" data-tk-action="regenerate-separate" title="${regenTitle}" aria-label="${regenTitle}"${regenDisabled}${regenBusy}>${ICON_REGEN}</button>`,
    '</div>',
  ].join('\n')
}

function wrapPanelShell(
  host: PluginHost,
  innerHtml: string,
  opts: {
    emptyReason?: PanelEmptyReason
    emptyDetail?: string
    /** 无数据空态：保留原文案旁的主按钮 */
    showEmptyRegenButton?: boolean
    showActions?: boolean
    editEnabled?: boolean
    regenEnabled?: boolean
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
  if (innerHtml.trim()) {
    parts.push(`<div class="tk-body">${innerHtml}</div>`)
  }
  parts.push(
    renderActionBar(host, {
      showActions: opts.showActions === true,
      editEnabled: opts.editEnabled === true,
      regenEnabled: opts.regenEnabled === true,
      regenerating: opts.regenerating,
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

    const lastTurn = turns.length > 0 ? turns[turns.length - 1]! : null
    const viewingOrdinal =
      resolved.kind === 'content'
        ? resolved.turnOrdinal
        : resolved.turnOrdinal
    const isLastTurnView =
      lastTurn !== null &&
      typeof viewingOrdinal === 'number' &&
      viewingOrdinal === lastTurn.turnOrdinal
    const shellActions = {
      showActions: turns.length > 0,
      editEnabled: resolved.kind === 'content',
      regenEnabled: isLastTurnView,
      regenerating,
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
  } catch (e) {
    console.warn('[trace-keeper] panel refresh failed', e)
  }
}

function openEditStateDialog(host: PluginHost): void {
  if (!lastEditContext || !host.openFormDialog) {
    console.warn('[trace-keeper]', host.t(k(host, 'toastEditNoState')))
    return
  }
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
    console.warn('[trace-keeper]', host.t(k(host, 'toastPatchInvalidJson')))
    return
  }

  try {
    await runPatchState(conversationId, turnOrdinal, state)
    if (host.conversation.refresh) {
      await host.conversation.refresh()
    }
    await refreshPanel(host)
    host.refreshSlotButtons()
  } catch (e) {
    const code = e instanceof Error ? e.message : 'patch_failed'
    console.warn('[trace-keeper]', host.t(k(host, 'toastPatchFailed'), { code }))
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
  const wantDebug = auditDebugEnabled(host)
  try {
    const result = await runSeparateRegenerate(conversationId, lastTurn.turnOrdinal, {
      requestDebug: wantDebug,
    })
    logSeparateDebugIfPresent(result.debug)
    if (wantDebug && !result.debug) {
      console.warn(
        '[trace-keeper] 已请求 debug 但响应无 debug 字段；请重启服务端并确认 Separate 路由已更新',
      )
    }
    if (host.conversation.refresh) {
      await host.conversation.refresh()
    }
  } catch (e) {
    if (e instanceof SeparateRegenerateError) {
      logSeparateDebugIfPresent(e.debug)
      if (wantDebug && !e.debug) {
        console.warn(
          '[trace-keeper] 已请求 debug 但错误响应无 debug 字段；请重启服务端并确认 Separate 路由已更新',
        )
      }
      console.warn(
        '[trace-keeper]',
        host.t(k(host, 'toastRegenerateFailed'), { code: e.code }),
      )
    } else if (e instanceof Error) {
      console.warn(
        '[trace-keeper]',
        host.t(k(host, 'toastRegenerateFailed'), { code: e.message }),
      )
    }
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
  host.lifecycle.onTurnDataChanged?.(() => {
    void refreshPanel(host)
    host.refreshSlotButtons()
  })
}

export function register(host: PluginHost): void {
  registerPanel(host)
  registerTurnButton(host)
  registerLifecycle(host)
}
