import { PLUGIN_ID } from './constants.js'
import { isBusy, openManualSummarize } from './dialogs.js'
import { k } from './settings.js'
import {
  getRangeStartTurn,
  setRangeStartTurn,
  summarizeRunning,
} from './state.js'
import type { PluginHost } from './types.js'

const RANGE_STYLES = `
.plugin-slot.cm-range-start--active {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
.plugin-slot.cm-range-end--ready:not(:disabled) {
  color: rgb(var(--v-theme-primary));
}
`

type SlotCtx = { turn?: { turnOrdinal?: number }; listIndex?: number }

function turnOrdinal(ctx: SlotCtx): number | null {
  const n = ctx.turn?.turnOrdinal
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

function controlsDisabled(host: PluginHost) {
  return summarizeRunning || isBusy(host)
}

function onRangeStartClick(host: PluginHost, ctx: SlotCtx) {
  const ord = turnOrdinal(ctx)
  if (ord === null || controlsDisabled(host)) return
  setRangeStartTurn(getRangeStartTurn() === ord ? null : ord)
  host.refreshSlotButtons()
}

function onRangeEndClick(host: PluginHost, ctx: SlotCtx) {
  const ord = turnOrdinal(ctx)
  const start = getRangeStartTurn()
  if (controlsDisabled(host)) return
  if (start === null) {
    host.ui.notify(host.t(k(host, 'toastRangeStartRequired')), undefined, { level: 'warning' })
    return
  }
  if (ord === null || ord < start) {
    host.ui.notify(host.t(k(host, 'toastInvalidRange')), undefined, { level: 'warning' })
    return
  }
  openManualSummarize(host, { startTurn: start, endTurn: ord })
}

export function registerRangePicker(host: PluginHost) {
  host.registerStyles(RANGE_STYLES)

  host.registerSlotButton('turn-block-head', {
    id: `${PLUGIN_ID}-range-start`,
    icon: (ctx: SlotCtx) => {
      const ord = turnOrdinal(ctx)
      const start = getRangeStartTurn()
      return ord !== null && start === ord
        ? 'mdi-arrow-right-drop-circle'
        : 'mdi-arrow-right-drop-circle-outline'
    },
    class: (ctx: SlotCtx) => {
      const ord = turnOrdinal(ctx)
      const start = getRangeStartTurn()
      return ord !== null && start === ord ? 'cm-range-start--active' : ''
    },
    tooltipKey: (ctx: SlotCtx) => {
      const ord = turnOrdinal(ctx)
      const start = getRangeStartTurn()
      return k(
        host,
        ord !== null && start === ord ? 'tooltipRangeStartCancel' : 'tooltipRangeStart',
      )
    },
    when: (ctx: SlotCtx) => turnOrdinal(ctx) !== null,
    disabled: () => controlsDisabled(host),
    onClick: (ctx: SlotCtx) => onRangeStartClick(host, ctx),
  })

  host.registerSlotButton('turn-block-head', {
    id: `${PLUGIN_ID}-range-end`,
    icon: 'mdi-arrow-left-drop-circle-outline',
    class: (ctx: SlotCtx) => {
      const ord = turnOrdinal(ctx)
      const start = getRangeStartTurn()
      if (start === null || ord === null) return ''
      return ord >= start ? 'cm-range-end--ready' : ''
    },
    tooltipKey: k(host, 'tooltipRangeEnd'),
    when: (ctx: SlotCtx) => turnOrdinal(ctx) !== null,
    disabled: (ctx: SlotCtx) => {
      if (controlsDisabled(host)) return true
      const ord = turnOrdinal(ctx)
      const start = getRangeStartTurn()
      if (start === null || ord === null) return true
      return ord < start
    },
    onClick: (ctx: SlotCtx) => onRangeEndClick(host, ctx),
  })
}
