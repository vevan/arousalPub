import { isValidConversationId } from './conversation-id.js'
import { resolvePluginCompleteApi } from './plugin-api-resolve.js'
import { createPluginServerHostApi } from './plugin-system/host-api.js'
import { loadEnabledServerPlugins } from './plugin-system/loader.js'
import type {
  PluginCompleteDraftContext,
  PluginCompleteDraftResult,
} from './plugin-system/types.js'

export type { PluginCompleteDraftContext }

export interface PluginCompleteDraftRequestBody {
  conversationId?: string
  apiConfigId?: string
  kind?: string
  systemReferenceContext?: string
  userContent?: string
  systemPromptTemplate?: string
  fromTurn?: number
  toTurn?: number
  sidecarName?: string
}

export type PluginCompleteDraftRouteResult =
  | ({ ok: true } & PluginCompleteDraftResult)
  | { ok: false; code: string; status?: number; detail?: string }

function parseDraftContext(
  pluginId: string,
  body: PluginCompleteDraftRequestBody,
): PluginCompleteDraftContext | { ok: false; code: string } {
  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  if (!conversationId || !isValidConversationId(conversationId)) {
    return { ok: false, code: 'invalid_conversation_id' }
  }

  const kind = body.kind === 'sidecar' ? 'sidecar' : body.kind === 'memory' ? 'memory' : null
  if (!kind) {
    return { ok: false, code: 'draft_kind_invalid' }
  }

  const systemReferenceContext =
    typeof body.systemReferenceContext === 'string' ? body.systemReferenceContext : ''

  const userContent =
    typeof body.userContent === 'string' ? body.userContent : ''
  if (!userContent.trim()) {
    return { ok: false, code: 'user_content_required' }
  }

  const systemPromptTemplate =
    typeof body.systemPromptTemplate === 'string' ? body.systemPromptTemplate : ''
  if (!systemPromptTemplate.trim()) {
    return { ok: false, code: 'system_prompt_required' }
  }

  const apiConfigId =
    typeof body.apiConfigId === 'string' ? body.apiConfigId.trim() : undefined

  const ctx: PluginCompleteDraftContext = {
    pluginId,
    conversationId,
    apiConfigId: apiConfigId || undefined,
    kind,
    systemReferenceContext,
    userContent,
    systemPromptTemplate,
  }

  if (typeof body.fromTurn === 'number' && Number.isInteger(body.fromTurn)) {
    ctx.fromTurn = body.fromTurn
  }
  if (typeof body.toTurn === 'number' && Number.isInteger(body.toTurn)) {
    ctx.toTurn = body.toTurn
  }
  if (kind === 'sidecar') {
    const sidecarName =
      typeof body.sidecarName === 'string' ? body.sidecarName.trim() : ''
    if (sidecarName) ctx.sidecarName = sidecarName
  }

  return ctx
}

export async function runPluginCompleteDraftRoute(
  pluginId: string,
  body: PluginCompleteDraftRequestBody,
  userId?: string,
): Promise<PluginCompleteDraftRouteResult> {
  const parsed = parseDraftContext(pluginId, body)
  if ('code' in parsed && !('conversationId' in parsed)) {
    return parsed
  }

  let ctx = parsed as PluginCompleteDraftContext

  const resolved = await resolvePluginCompleteApi({
    pluginId,
    conversationId: ctx.conversationId,
    apiConfigId: ctx.apiConfigId,
    userId,
  })
  if (!resolved.ok) {
    return { ok: false, code: resolved.code }
  }
  ctx = { ...ctx, apiConfigId: resolved.resolved.apiConfigId }

  const loaded = await loadEnabledServerPlugins(userId)
  const plugin = loaded.find((p) => p.id === pluginId)
  if (!plugin?.module.completeDraft) {
    return { ok: false, code: 'plugin_hook_not_supported', status: 404 }
  }

  const api = createPluginServerHostApi(pluginId, userId)
  try {
    const result = await plugin.module.completeDraft(ctx, api)
    if (!result?.draft || typeof result.draft.content !== 'string') {
      return { ok: false, code: 'plugin_complete_draft_failed' }
    }
    return { ok: true, ...result }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'plugin_complete_draft_failed'
    if (msg === 'context_exceeded' || msg === 'context_length_unconfigured') {
      return { ok: false, code: msg }
    }
    if (msg === 'parse_failed') {
      return { ok: false, code: 'parse_failed' }
    }
    return {
      ok: false,
      code: 'plugin_complete_draft_failed',
      detail: msg,
    }
  }
}
