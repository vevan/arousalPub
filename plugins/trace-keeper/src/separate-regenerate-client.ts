import { PLUGIN_ID } from './constants.js'

export interface SeparateRegenerateResult {
  ok: true
  state: Record<string, unknown>
  turnOrdinal: number
  receiveId: string
}

export async function runSeparateRegenerate(
  conversationId: string,
  turnOrdinal?: number,
): Promise<SeparateRegenerateResult> {
  const res = await fetch(
    `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/regenerate-separate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        ...(typeof turnOrdinal === 'number' ? { turnOrdinal } : {}),
      }),
    },
  )
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `http_${res.status}`)
  }
  const data = (await res.json()) as SeparateRegenerateResult & { ok?: boolean }
  if (!data || typeof data.state !== 'object') {
    throw new Error('regenerate_separate_invalid_response')
  }
  return data
}
