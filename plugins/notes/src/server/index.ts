import {
  listNotes,
  saveNote,
  deleteNote,
  reorderNotes,
} from './actions.js'
import type { PluginDataApi } from '../../../../server/src/plugin-system/types.js'

type Api = { pluginData: PluginDataApi }

export async function runPluginAction(
  action: string,
  body: Record<string, unknown>,
  api: Api,
): Promise<{ ok: true } & Record<string, unknown> | { ok: false; code: string; status?: number }> {
  const data = api.pluginData

  try {
    if (action === 'list-notes') {
      const result = await listNotes(body, data)
      return { ok: true, ...result }
    }

    if (action === 'save-note') {
      const result = await saveNote(body, data)
      return { ok: true, ...result }
    }

    if (action === 'delete-note') {
      const result = await deleteNote(body, data)
      return { ok: true, ...result }
    }

    if (action === 'reorder-notes') {
      const result = await reorderNotes(body, data)
      return { ok: true, ...result }
    }

    return { ok: false, code: 'unknown_action', status: 404 }
  } catch (e: unknown) {
    const err = e as { message?: string; status?: number } | null
    const code = err?.message?.trim() || 'notes_action_failed'
    const status = typeof err?.status === 'number' ? err.status : 500
    return { ok: false, code, status }
  }
}
