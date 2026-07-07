import { apiFetch } from '@/utils/api-fetch'
import { useLorebooksStore } from '@/stores/lorebooks'
import type { LorebookEntry } from '@/stores/lorebooks'
import { useConversationPluginSettingsStore } from '@/stores/conversation-plugin-settings'
import { PluginHostApiError } from '@/plugins/plugin-host-api-error'
import type {
  LorebookDto,
  LorebookEntryCreateBody,
  LorebookEntryDto,
  LorebookEntryPatchBody,
  LorebookEnsureResult,
  LorebookNormalizeEntryRefsRequest,
  LorebookApplyOrderRequest,
  LorebookApplyOrderResult,
  LorebookSummaryDto,
  PluginCompleteRequest,
  PluginCompleteResponse,
  PluginCompletePreflightResult,
  PluginPrepareContextBlocksRequest,
  PluginPrepareContextBlocksResponse,
  AssemblePluginPromptRequest,
  AssemblePluginPromptSuccess,
} from '@/plugins/types'
import type {
  CompleteWithContextRequest,
  CompleteWithContextSuccess,
} from '@/shared/plugin-context-blocks'

async function throwIfNotOk(res: Response, fallbackCode: string): Promise<void> {
  if (res.ok) return
  let code = fallbackCode
  let detail: string | undefined
  let promptTokens: number | undefined
  let budget: number | undefined
  try {
    const data = (await res.json()) as {
      error?: string
      code?: string
      detail?: string
      promptTokens?: number
      budget?: number
    }
    if (typeof data.code === 'string' && data.code.trim()) {
      code = data.code.trim()
    } else if (typeof data.error === 'string' && data.error.trim()) {
      code = data.error.trim()
    }
    if (typeof data.detail === 'string' && data.detail.trim()) {
      detail = data.detail.trim()
    }
    if (typeof data.promptTokens === 'number') {
      promptTokens = data.promptTokens
    }
    if (typeof data.budget === 'number') {
      budget = data.budget
    }
  } catch {
    code = `http_${res.status}`
  }
  throw new PluginHostApiError(code, res.status, detail, { promptTokens, budget })
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

function syncLorebookToStore(lorebook: LorebookDto): void {
  try {
    useLorebooksStore().upsertLorebookFromPlugin(lorebook as import('@/stores/lorebooks').Lorebook)
  } catch {
    /* pinia 未就绪时忽略 */
  }
}

export async function ensureLorebook(
  pluginId: string,
  conversationId: string,
  nameTemplate?: string,
): Promise<LorebookEnsureResult> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/lorebooks/ensure`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        ...(nameTemplate !== undefined ? { nameTemplate } : {}),
      }),
    },
  )
  await throwIfNotOk(res, 'lorebooks_write_failed')
  const data = (await res.json()) as {
    id?: string
    name?: string
    created?: boolean
    lorebook?: LorebookDto
  }
  const id = typeof data.id === 'string' ? data.id.trim() : ''
  if (!id) {
    throw new PluginHostApiError('lorebooks_write_failed', res.status)
  }
  if (data.lorebook && typeof data.lorebook === 'object') {
    syncLorebookToStore(data.lorebook)
  }
  return {
    id,
    name: typeof data.name === 'string' ? data.name : id,
    created: data.created === true,
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

export async function createLorebookEntriesBatch(
  pluginId: string,
  lorebookId: string,
  entries: LorebookEntryCreateBody[],
): Promise<LorebookEntryDto[]> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/lorebooks/${encodeURIComponent(lorebookId)}/entries/batch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    },
  )
  await throwIfNotOk(res, 'lorebook_entry_create_failed')
  const data = (await res.json()) as { entries?: LorebookEntryDto[] }
  if (!Array.isArray(data.entries)) {
    throw new PluginHostApiError('lorebook_entry_create_failed', res.status)
  }
  for (const entry of data.entries) {
    syncLorebookEntryToStore(lorebookId, entry, 'create')
  }
  return data.entries
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

export async function runPluginPrepareContextBlocks(
  pluginId: string,
  conversationId: string,
  req: PluginPrepareContextBlocksRequest,
  signal?: AbortSignal,
): Promise<PluginPrepareContextBlocksResponse> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/prepare-context`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, blocks: req.blocks }),
      signal,
    },
  )
  await throwIfNotOk(res, 'plugin_prepare_context_failed')
  const data = (await res.json()) as
    | PluginPrepareContextBlocksResponse
    | { ok: false; code?: string }
  if ('ok' in data && data.ok === false) {
    throw new PluginHostApiError(
      typeof data.code === 'string' && data.code.trim() ? data.code.trim() : 'plugin_prepare_context_failed',
      res.status,
    )
  }
  return data
}

export async function runAssemblePluginPrompt(
  pluginId: string,
  conversationId: string,
  req: Omit<AssemblePluginPromptRequest, 'conversationId'>,
  signal?: AbortSignal,
): Promise<AssemblePluginPromptSuccess> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/assemble-plugin-prompt`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, ...req }),
      signal,
    },
  )
  await throwIfNotOk(res, 'plugin_assemble_prompt_failed')
  const data = (await res.json()) as AssemblePluginPromptSuccess
  if (!data.ok || !Array.isArray(data.messages)) {
    throw new PluginHostApiError('plugin_assemble_prompt_failed', res.status)
  }
  return data
}

export async function runCompleteWithContext(
  pluginId: string,
  conversationId: string,
  req: Omit<CompleteWithContextRequest, 'conversationId'>,
  signal?: AbortSignal,
): Promise<CompleteWithContextSuccess> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/complete-with-context`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, ...req }),
      signal,
    },
  )
  await throwIfNotOk(res, 'plugin_complete_with_context_failed')
  const data = (await res.json()) as CompleteWithContextSuccess
  if (!data.ok) {
    throw new PluginHostApiError('plugin_complete_with_context_failed', res.status)
  }
  return data
}

export async function normalizeLorebookEntryRefs(
  pluginId: string,
  req: LorebookNormalizeEntryRefsRequest,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/lorebooks/normalize-entry-refs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    },
  )
  await throwIfNotOk(res, 'lorebook_entry_refs_failed')
  const data = (await res.json()) as { ok?: boolean; entryIds?: Record<string, string> }
  if (!data.ok || !data.entryIds || typeof data.entryIds !== 'object') {
    throw new PluginHostApiError('lorebook_entry_refs_failed', res.status)
  }
  return data.entryIds
}

export async function applyLorebookOrder(
  pluginId: string,
  lorebookId: string,
  req: LorebookApplyOrderRequest,
  signal?: AbortSignal,
): Promise<LorebookApplyOrderResult> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/lorebooks/${encodeURIComponent(lorebookId)}/apply-order`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    },
  )
  await throwIfNotOk(res, 'lorebook_entry_patch_failed')
  const data = (await res.json()) as LorebookApplyOrderResult & { ok?: boolean }
  if (!data.ok || !data.lorebook || typeof data.lorebook !== 'object') {
    throw new PluginHostApiError('lorebook_entry_patch_failed', res.status)
  }
  syncLorebookToStore(data.lorebook)
  return data
}

export async function runPluginComplete(
  pluginId: string,
  conversationId: string,
  req: PluginCompleteRequest,
  signal?: AbortSignal,
): Promise<PluginCompleteResponse> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, ...req }),
      signal,
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
  opts?: { apiConfigId?: string; toTurn?: number; persistVars?: boolean },
  signal?: AbortSignal,
): Promise<string> {
  const toTurn =
    typeof opts?.toTurn === 'number' &&
    Number.isInteger(opts.toTurn) &&
    opts.toTurn >= 0
      ? opts.toTurn
      : undefined
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/macros/expand`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        conversationId,
        apiConfigId: opts?.apiConfigId?.trim() || undefined,
        toTurn,
        persistVars: opts?.persistVars,
      }),
      signal,
    },
  )
  await throwIfNotOk(res, 'plugin_macro_expand_failed')
  const data = (await res.json()) as { text?: string }
  return typeof data.text === 'string' ? data.text : text
}

export async function runPluginCompletePreflight(
  pluginId: string,
  conversationId: string,
  req: {
    apiConfigId?: string
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  },
  signal?: AbortSignal,
): Promise<PluginCompletePreflightResult> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/complete/preflight`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, ...req }),
      signal,
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
  const saved =
    bag && typeof bag === 'object' && !Array.isArray(bag) ? { ...bag } : {}
  useConversationPluginSettingsStore().setBag(conversationId, pluginId, saved)
  return saved
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
  const saved =
    bag && typeof bag === 'object' && !Array.isArray(bag) ? { ...bag } : {}
  useConversationPluginSettingsStore().setBag(conversationId, pluginId, saved)
  return saved
}

/** manifest `serverActions` · POST /api/plugins/:id/actions/:action */
export async function runPluginAction(
  pluginId: string,
  action: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await apiFetch(
    `/api/plugins/${encodeURIComponent(pluginId)}/actions/${encodeURIComponent(action)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  )
  if (!res.ok) {
    let code = 'plugin_action_failed'
    let detail: string | undefined
    let debug: unknown
    try {
      const data = (await res.json()) as {
        error?: string
        code?: string
        detail?: string
        debug?: unknown
      }
      if (typeof data.code === 'string' && data.code.trim()) {
        code = data.code.trim()
      } else if (typeof data.error === 'string' && data.error.trim()) {
        code = data.error.trim()
      }
      if (typeof data.detail === 'string' && data.detail.trim()) {
        detail = data.detail.trim()
      }
      if ('debug' in data) debug = data.debug
    } catch {
      code = `http_${res.status}`
    }
    throw new PluginHostApiError(code, res.status, detail, { debug })
  }
  const data = (await res.json()) as Record<string, unknown>
  if (!data || typeof data !== 'object') {
    throw new PluginHostApiError('plugin_action_invalid_response', res.status)
  }
  return data
}
