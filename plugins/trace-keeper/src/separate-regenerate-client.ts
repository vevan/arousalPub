import type { TraceKeeperSeparateDebug } from './separate-debug.js'
import type { PluginHost } from './types.js'

export interface SeparateRegenerateResult {
  ok: true
  state: Record<string, unknown>
  turnOrdinal: number
  receiveId: string
  debug?: TraceKeeperSeparateDebug
}

export class SeparateRegenerateError extends Error {
  readonly code: string
  readonly detail?: string
  readonly debug?: TraceKeeperSeparateDebug

  constructor(
    code: string,
    opts?: { detail?: string; debug?: TraceKeeperSeparateDebug },
  ) {
    super(code)
    this.name = 'SeparateRegenerateError'
    this.code = code
    this.detail = opts?.detail
    this.debug = opts?.debug
  }
}

function actionErrorCode(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { code?: string; message?: string; detail?: string }
    if (typeof o.detail === 'string' && o.detail.trim()) return o.detail.trim()
    if (typeof o.code === 'string' && o.code.trim()) return o.code.trim()
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim()
  }
  return 'regenerate_separate_failed'
}

function actionErrorDebug(e: unknown): TraceKeeperSeparateDebug | undefined {
  if (e && typeof e === 'object' && 'debug' in e) {
    const debug = (e as { debug?: TraceKeeperSeparateDebug }).debug
    return debug && typeof debug === 'object' ? debug : undefined
  }
  return undefined
}

export async function runSeparateRegenerate(
  host: PluginHost,
  conversationId: string,
  turnOrdinal?: number,
): Promise<SeparateRegenerateResult> {
  try {
    const data = await host.plugin.runAction('regenerate-separate', {
      conversationId,
      ...(typeof turnOrdinal === 'number' ? { turnOrdinal } : {}),
    })
    if (!data || typeof data.state !== 'object') {
      throw new Error('regenerate_separate_invalid_response')
    }
    return {
      state: data.state as Record<string, unknown>,
      turnOrdinal: data.turnOrdinal as number,
      receiveId: String(data.receiveId ?? ''),
      ok: true,
      ...(data.debug ? { debug: data.debug as TraceKeeperSeparateDebug } : {}),
    }
  } catch (e) {
    throw new SeparateRegenerateError(actionErrorCode(e), {
      detail:
        e && typeof e === 'object' && 'detail' in e
          ? String((e as { detail?: string }).detail ?? '')
          : undefined,
      debug: actionErrorDebug(e),
    })
  }
}
