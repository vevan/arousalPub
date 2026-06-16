import { PLUGIN_ID } from './constants.js'
import type { TraceKeeperSeparateDebug } from './separate-debug.js'

export interface SeparateRegenerateResult {
  ok: true
  state: Record<string, unknown>
  turnOrdinal: number
  receiveId: string
  debug?: TraceKeeperSeparateDebug
}

type SeparateRegenerateErrorBody = {
  error?: string
  detail?: string
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

export async function runSeparateRegenerate(
  conversationId: string,
  turnOrdinal?: number,
  opts?: { requestDebug?: boolean },
): Promise<SeparateRegenerateResult> {
  const res = await fetch(
    `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/regenerate-separate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        ...(typeof turnOrdinal === 'number' ? { turnOrdinal } : {}),
        ...(opts?.requestDebug ? { debug: true } : {}),
      }),
    },
  )
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as SeparateRegenerateErrorBody
    throw new SeparateRegenerateError(err.error ?? `http_${res.status}`, {
      detail: err.detail,
      debug: err.debug,
    })
  }
  const data = (await res.json()) as SeparateRegenerateResult & {
    ok?: boolean
    debug?: TraceKeeperSeparateDebug
  }
  if (!data || typeof data.state !== 'object') {
    throw new Error('regenerate_separate_invalid_response')
  }
  return {
    state: data.state,
    turnOrdinal: data.turnOrdinal,
    receiveId: data.receiveId,
    ok: true,
    ...(data.debug ? { debug: data.debug } : {}),
  }
}
