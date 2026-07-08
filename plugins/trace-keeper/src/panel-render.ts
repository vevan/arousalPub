import Handlebars from 'handlebars'
import { type TracePanelMeta, type TraceBundle } from './constants.js'

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

export {
  findTracePayloadForTurn,
  findTracePayloadInTurnPlugins,
  resolveLiveTraceState,
  resolveLiveTraceStates,
  resolveTraceForSegment,
  tracePanelMetaForSegment,
} from './trace-state-resolve.js'
