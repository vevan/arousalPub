import { apiFetch } from '@/utils/api-fetch'
import { useLorebooksStore } from '@/stores/lorebooks'
import type { LorebookEntry } from '@/stores/lorebooks'
import { PluginHostApiError } from '@/plugins/plugin-host-api-error'
import type {
  LorebookDto,
  LorebookEntryCreateBody,
  LorebookEntryDto,
  LorebookEntryPatchBody,
  LorebookSummaryDto,
  PluginCompleteRequest,
  PluginCompleteResponse,
  PluginCompletePreflightResult,
} from '@/plugins/types'

async function throwIfNotOk(res: Response, fallbackCode: string): Promise<void> {
  if (res.ok) return
  let code = fallbackCode
  let detail: string | undefined
  try {
    const data = (await res.json()) as { error?: string; detail?: string }
    if (typeof data.error === 'string' && data.error.trim()) {
      code = data.error.trim()
    }
    if (typeof data.detail === 'string' && data.detail.trim()) {
      detail = data.detail.trim()
    }
  } catch {
    code = `http_${res.status}`
  }
  throw new PluginHostApiError(code, res.status, detail)
}

function mapLorebookSummaries(data: { lorebooks?: unknown[] }): LorebookSummaryDto[] {
  if (!Array.isArray(data.lorebooks)) return []
  return data.lorebooks
    .map((lb): LorebookSummaryDto | null => {
      if (!lb || typeof lb !== 'object') return null
      const o = lb as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id : ''
      const name = typeof o.name === 'string' ? o.name : ''
      const updatedAt =
        typeof o.updatedAt === 'string'
          ? o.updatedAt
          : typeof o.createdAt === 'string'
            ? o.createdAt
            : ''
      if (!id) return null
      return { id, name, updatedAt }
    })
    .filter((x): x is LorebookSummaryDto => x !== null)
}

export async function fetchLorebookList(
  pluginId: string,
): Promise<LorebookSummaryDto[]> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/lorebooks`,
  )
  await throwIfNotOk(res, 'lorebooks_read_failed')
  const data = (await res.json()) as { lorebooks?: unknown[] }
  return mapLorebookSummaries(data)
}

export async function fetchLorebookById(
  pluginId: string,
  id: string,
): Promise<LorebookDto> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/lorebooks/${encodeURIComponent(id)}`,
  )
  await throwIfNotOk(res, 'lorebook_not_found')
  return (await res.json()) as LorebookDto
}

function syncLorebookEntryToStore(
  lorebookId: string,
  entry: LorebookEntryDto,
  mode: 'create' | 'patch',
): void {
  try {
    useLorebooksStore().upsertEntryFromPlugin(
      lorebookId,
      entry as LorebookEntry,
      mode,
    )
  } catch {
    /* pinia 未就绪时忽略 */
  }
}

export async function createLorebookEntry(
  pluginId: string,
  lorebookId: string,
  body: LorebookEntryCreateBody,
): Promise<LorebookEntryDto> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/lorebooks/${encodeURIComponent(lorebookId)}/entries`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  await throwIfNotOk(res, 'lorebook_entry_create_failed')
  const data = (await res.json()) as { entry?: LorebookEntryDto }
  if (!data.entry) {
    throw new PluginHostApiError('lorebook_entry_create_failed', res.status)
  }
  syncLorebookEntryToStore(lorebookId, data.entry, 'create')
  return data.entry
}

export async function patchLorebookEntry(
  pluginId: string,
  lorebookId: string,
  entryId: string,
  body: LorebookEntryPatchBody,
): Promise<LorebookEntryDto> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/lorebooks/${encodeURIComponent(lorebookId)}/entries/${encodeURIComponent(entryId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  await throwIfNotOk(res, 'lorebook_entry_patch_failed')
  const data = (await res.json()) as { entry?: LorebookEntryDto }
  if (!data.entry) {
    throw new PluginHostApiError('lorebook_entry_patch_failed', res.status)
  }
  syncLorebookEntryToStore(lorebookId, data.entry, 'patch')
  return data.entry
}

export async function fetchApiPresets(): Promise<{ id: string; alias: string }[]> {
  const res = await apiFetch('/api/settings')
  await throwIfNotOk(res, 'settings_read_failed')
  const data = (await res.json()) as { presets?: unknown[] }
  if (!Array.isArray(data.presets)) return []
  return data.presets
    .map((p) => {
      if (!p || typeof p !== 'object') return null
      const o = p as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id : ''
      const alias = typeof o.alias === 'string' ? o.alias : id
      if (!id) return null
      return { id, alias }
    })
    .filter((x): x is { id: string; alias: string } => x !== null)
}

export async function runPluginComplete(
  pluginId: string,
  req: PluginCompleteRequest,
): Promise<PluginCompleteResponse> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
  )
  await throwIfNotOk(res, 'plugin_complete_failed')
  const data = (await res.json()) as PluginCompleteResponse
  if (!data.ok || typeof data.content !== 'string') {
    throw new PluginHostApiError('plugin_complete_failed', res.status)
  }
  return data
}

export async function expandPluginMacros(
  pluginId: string,
  conversationId: string,
  text: string,
  opts?: { apiConfigId?: string },
): Promise<string> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/macros/expand`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        conversationId,
        apiConfigId: opts?.apiConfigId?.trim() || undefined,
      }),
    },
  )
  await throwIfNotOk(res, 'plugin_macro_expand_failed')
  const data = (await res.json()) as { text?: string }
  return typeof data.text === 'string' ? data.text : text
}

export async function runPluginCompletePreflight(
  pluginId: string,
  req: {
    apiConfigId: string
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  },
): Promise<PluginCompletePreflightResult> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/complete/preflight`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
  )
  await throwIfNotOk(res, 'plugin_complete_preflight_failed')
  return (await res.json()) as PluginCompletePreflightResult
}

export async function fetchPluginUserSettings(
  pluginId: string,
): Promise<Record<string, unknown>> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/settings`,
  )
  await throwIfNotOk(res, 'plugin_settings_read_failed')
  const data = (await res.json()) as { settings?: Record<string, unknown> }
  return data.settings && typeof data.settings === 'object' ? data.settings : {}
}

export async function fetchConversationPluginSettings(
  conversationId: string,
  pluginId: string,
): Promise<Record<string, unknown>> {
  const res = await apiFetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}`,
  )
  await throwIfNotOk(res, 'conversation_not_found')
  const idx = (await res.json()) as {
    pluginSettings?: Record<string, Record<string, unknown>>
  }
  const bag = idx.pluginSettings?.[pluginId]
  return bag && typeof bag === 'object' && !Array.isArray(bag) ? { ...bag } : {}
}

export async function patchConversationPluginSettings(
  conversationId: string,
  pluginId: string,
  partial: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await apiFetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pluginSettings: { [pluginId]: partial },
      }),
    },
  )
  await throwIfNotOk(res, 'plugin_settings_invalid')
  const data = (await res.json()) as {
    index?: { pluginSettings?: Record<string, Record<string, unknown>> }
  }
  const bag = data.index?.pluginSettings?.[pluginId]
  return bag && typeof bag === 'object' && !Array.isArray(bag) ? { ...bag } : {}
}
