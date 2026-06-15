import Handlebars from 'handlebars'
import {
  PLUGIN_ID,
  type TraceKeeperPayload,
  type TracePanelMeta,
  type TraceBundle,
} from './constants.js'

let helpersRegistered = false

function registerHelpers(): void {
  if (helpersRegistered) return
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b)
  Handlebars.registerHelper('json', (value: unknown) => JSON.stringify(value))
  helpersRegistered = true
}

export function renderTracePanelHtml(
  bundle: TraceBundle,
  data: Record<string, unknown>,
  meta: TracePanelMeta,
): string {
  registerHelpers()
  const tpl = Handlebars.compile(bundle.template, { noEscape: false })
  return tpl({ data, meta })
}

export function findTracePayloadInTurnPlugins(
  plugins: unknown[] | undefined,
  epoch: number,
): TraceKeeperPayload | null {
  if (!Array.isArray(plugins)) return null
  for (let i = plugins.length - 1; i >= 0; i -= 1) {
    const raw = plugins[i]
    if (!raw || typeof raw !== 'object') continue
    const pluginId = (raw as { pluginId?: unknown }).pluginId
    if (pluginId !== PLUGIN_ID) continue
    const payload = (raw as { payload?: unknown }).payload
    if (!payload || typeof payload !== 'object') continue
    const state = (payload as { state?: unknown }).state
    const payloadEpoch = (payload as { epoch?: unknown }).epoch
    const entryEpoch =
      typeof payloadEpoch === 'number' && Number.isFinite(payloadEpoch)
        ? Math.round(payloadEpoch)
        : 0
    if (entryEpoch !== epoch) continue
    if (!state || typeof state !== 'object' || Array.isArray(state)) continue
    return {
      state: state as Record<string, unknown>,
      epoch: entryEpoch,
      receiveId:
        typeof (payload as { receiveId?: unknown }).receiveId === 'string'
          ? (payload as { receiveId: string }).receiveId
          : undefined,
    }
  }
  return null
}

export function resolveLiveTraceState(
  turns: { turnOrdinal: number; plugins?: unknown[] }[],
  epoch: number,
): { state: Record<string, unknown>; turnOrdinal: number } | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]
    const hit = findTracePayloadInTurnPlugins(turn.plugins, epoch)
    if (hit) {
      return { state: hit.state, turnOrdinal: turn.turnOrdinal }
    }
  }
  return null
}
