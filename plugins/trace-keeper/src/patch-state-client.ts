import { normalizePatchState } from './parse-block.js'
import type { PluginHost } from './types.js'

export interface PatchStateResult {
  ok: true
  state: Record<string, unknown>
  turnOrdinal: number
  receiveId?: string
}

export async function runPatchState(
  host: PluginHost,
  conversationId: string,
  turnOrdinal: number,
  state: Record<string, unknown>,
): Promise<PatchStateResult> {
  const data = await host.plugin.runAction('patch-state', {
    conversationId,
    turnOrdinal,
    state,
  })
  if (!data || typeof data.state !== 'object') {
    throw new Error('patch_state_invalid_response')
  }
  return data as PatchStateResult
}

export function parseStateJsonText(text: string): Record<string, unknown> | null {
  return normalizePatchState(text)
}
