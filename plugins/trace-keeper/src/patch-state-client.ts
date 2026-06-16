import { PLUGIN_ID } from './constants.js'
import { normalizePatchState } from './parse-block.js'

export interface PatchStateResult {
  ok: true
  state: Record<string, unknown>
  turnOrdinal: number
  receiveId?: string
}

export async function runPatchState(
  conversationId: string,
  turnOrdinal: number,
  state: Record<string, unknown>,
): Promise<PatchStateResult> {
  const res = await fetch(
    `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/patch-state`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, turnOrdinal, state }),
    },
  )
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `http_${res.status}`)
  }
  const data = (await res.json()) as PatchStateResult & { ok?: boolean }
  if (!data || typeof data.state !== 'object') {
    throw new Error('patch_state_invalid_response')
  }
  return data
}

export function parseStateJsonText(text: string): Record<string, unknown> | null {
  return normalizePatchState(text)
}
