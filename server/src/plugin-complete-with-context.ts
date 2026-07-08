import { resolvePluginCompleteApi } from './plugin-api-resolve.js'
import { runAssemblePluginPrompt, parsePromptLayout } from './plugin-assemble-prompt.js'
import { runPluginComplete } from './plugin-complete.js'
import { runPluginContextBlocksResolve, parseContextBlockSpecs } from './plugin-context-blocks-resolve.js'
import { resolvePluginCaptureDebug } from './plugin-audit-gate.js'
import { loadEnabledServerPlugins } from './plugin-system/loader.js'
import { createPluginServerHostApi } from './plugin-system/host-api.js'
import type {
  CompleteWithContextDraftParse,
  CompleteWithContextRequest,
  CompleteWithContextResult,
  LorebookEntrySlice,
  PluginContextBlocksSuccess,
} from './shared/plugin-context-blocks.js'

const UPSTREAM_RETRY_MAX = 3
const PIPELINE_FATAL = new Set([
  'context_exceeded',
  'context_length_unconfigured',
  'invalid_conversation_id',
  'invalid_layout',
  'anchor_to_turn_required',
  'blocks_required',
  'conversation_not_found',
  'draft_kind_invalid',
  'user_content_required',
  'system_prompt_required',
])
const UPSTREAM_RETRY = new Set(['plugin_complete_failed', 'preflight_failed'])

export type FormatPluginContextBlocksHook = (
  resolved: PluginContextBlocksSuccess,
  ctx: { anchorToTurn: number },
) => Record<string, string> | Promise<Record<string, string>>

function defaultLayoutBlocks(
  resolved: PluginContextBlocksSuccess,
): Record<string, string> {
  const out = { ...resolved.blocks }
  for (const [blockId, entries] of Object.entries(resolved.entriesByBlock)) {
    if (out[blockId]?.trim()) continue
    if (!entries?.length) continue
    out[blockId] = entries
      .map((e) => {
        const title = e.title.trim()
        const content = (e.content ?? '').trim()
        if (!title) return content
        return `## ${title}\n${content}`
      })
      .filter(Boolean)
      .join('\n\n')
  }
  return out
}

async function resolveLayoutBlocks(
  pluginId: string,
  resolved: PluginContextBlocksSuccess,
  anchorToTurn: number,
  userId?: string,
): Promise<Record<string, string>> {
  if (pluginId.trim()) {
    const loaded = await loadEnabledServerPlugins(userId)
    const plugin = loaded.find((p) => p.id === pluginId.trim())
    const hook = plugin?.module.formatPluginContextBlocks as
      | FormatPluginContextBlocksHook
      | undefined
    if (typeof hook === 'function') {
      return hook(resolved, { anchorToTurn })
    }
  }
  return defaultLayoutBlocks(resolved)
}

async function parseDraftViaHook(
  pluginId: string,
  conversationId: string,
  apiConfigId: string | undefined,
  draft: CompleteWithContextDraftParse,
  content: string,
  pluginSettings: Record<string, unknown> | undefined,
  userId?: string,
): Promise<
  | { ok: true; draft: { title: string; content: string; keywords: string[] } }
  | { ok: false; code: string; detail?: string }
> {
  const loaded = await loadEnabledServerPlugins(userId)
  const plugin = loaded.find((p) => p.id === pluginId.trim())
  if (!plugin?.module.parseCompleteDraftContent) {
    return { ok: false, code: 'plugin_hook_not_supported' }
  }
  const api = createPluginServerHostApi(pluginId, userId)
  try {
    const parsed = await plugin.module.parseCompleteDraftContent(
      {
        pluginId,
        conversationId,
        apiConfigId,
        kind: draft.kind,
        systemReferenceContext: '',
        userContent: '',
        systemPromptTemplate: '',
        fromTurn: draft.fromTurn,
        toTurn: draft.toTurn,
        blockTurns: draft.blockTurns,
        pluginSettings,
      },
      content,
      api,
    )
    if (!parsed?.draft || typeof parsed.draft.content !== 'string') {
      return { ok: false, code: 'plugin_complete_draft_failed' }
    }
    return { ok: true, draft: parsed.draft }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'parse_failed'
    if (msg === 'parse_failed') return { ok: false, code: 'parse_failed' }
    return { ok: false, code: 'plugin_complete_draft_failed', detail: msg }
  }
}

export type ResolveApiConfigIdForCompleteResult =
  | { ok: true; apiConfigId?: string; modelOverride?: string }
  | { ok: false; code: string }

/** 解析出站 API；非 dryRun 时必须成功。供 completeOnce 与单测使用。 */
export async function resolveApiConfigIdForCompleteWithContext(
  req: Pick<
    CompleteWithContextRequest,
    'conversationId' | 'apiConfigId' | 'dryRun' | 'fallbackToGlobalDefault'
  >,
  pluginId: string,
  userId?: string,
): Promise<ResolveApiConfigIdForCompleteResult> {
  const conversationId = req.conversationId.trim()
  let apiConfigId =
    typeof req.apiConfigId === 'string' ? req.apiConfigId.trim() : ''
  let modelOverride: string | undefined
  if (!apiConfigId && pluginId.trim()) {
    const hit = await resolvePluginCompleteApi({
      pluginId: pluginId.trim(),
      conversationId,
      userId,
      fallbackToGlobalDefault: req.fallbackToGlobalDefault !== false,
    })
    if (!hit.ok) {
      if (req.dryRun === true) {
        return { ok: true, apiConfigId: undefined }
      }
      return { ok: false, code: hit.code }
    }
    apiConfigId = hit.resolved.apiConfigId
    modelOverride = hit.resolved.modelOverride?.trim() || undefined
  }
  if (req.dryRun !== true && !apiConfigId) {
    return { ok: false, code: 'api_config_not_found' }
  }
  return { ok: true, apiConfigId: apiConfigId || undefined, modelOverride }
}

async function completeOnce(
  req: CompleteWithContextRequest,
  pluginId: string,
  userId?: string,
): Promise<CompleteWithContextResult> {
  const conversationId = req.conversationId.trim()
  const captureDebug = await resolvePluginCaptureDebug(
    conversationId,
    req.captureDebug === true,
  )
  const blocks = Array.isArray(req.blocks) ? req.blocks : []
  const prepared = req.preparedContext
  if (!prepared && blocks.length === 0) {
    return { ok: false, code: 'blocks_required' }
  }

  const step1 = prepared
    ? {
        ok: true as const,
        blocks: prepared.blocks,
        entriesByBlock: prepared.entriesByBlock ?? {},
        meta: prepared.meta,
      }
    : await runPluginContextBlocksResolve({ conversationId, blocks })
  if (!step1.ok) {
    return step1
  }

  const layoutBlocks = await resolveLayoutBlocks(
    pluginId,
    step1,
    req.anchorToTurn,
    userId,
  )

  const apiHit = await resolveApiConfigIdForCompleteWithContext(req, pluginId, userId)
  if (!apiHit.ok) {
    return apiHit
  }

  const assembled = await runAssemblePluginPrompt({
    conversationId,
    blocks: layoutBlocks,
    layout: req.layout,
    pluginSettings: req.pluginSettings,
    anchorToTurn: req.anchorToTurn,
    apiConfigId: apiHit.apiConfigId,
    dryRun: req.dryRun,
  })
  if (!assembled.ok) {
    return assembled
  }

  if (req.dryRun === true) {
    return {
      ok: true,
      messages: assembled.messages,
      preflight: assembled.preflight,
    }
  }

  const apiConfigId = apiHit.apiConfigId
  if (!apiConfigId) {
    return { ok: false, code: 'api_config_not_found' }
  }

  const complete = await runPluginComplete({
    apiConfigId,
    messages: assembled.messages,
    modelOverride: apiHit.modelOverride,
    responseFormat: req.responseFormat ?? 'json_object',
    captureDebug,
  })
  if (!complete.ok) {
    const debug =
      captureDebug
        ? {
            messages: assembled.messages,
            ...(complete.debug ?? {}),
          }
        : complete.debug
    return {
      ok: false,
      code: complete.code ?? 'plugin_complete_failed',
      ...(captureDebug ? { messages: assembled.messages } : {}),
      ...(debug ? { debug } : {}),
    }
  }

  const result: CompleteWithContextResult = {
    ok: true,
    content: complete.content,
    usage: complete.usage,
    latencyMs: complete.latencyMs,
    messages: assembled.messages,
    preflight: assembled.preflight,
    ...(complete.debug ? { debug: complete.debug } : {}),
  }

  if (req.draft && pluginId.trim()) {
    const parsed = await parseDraftViaHook(
      pluginId,
      conversationId,
      apiConfigId,
      req.draft,
      complete.content,
      req.pluginSettings,
      userId,
    )
    if (!parsed.ok) {
      return parsed
    }
    if (result.ok) {
      result.draft = parsed.draft
    }
  }

  return result
}

export async function runCompleteWithContext(
  pluginId: string,
  req: CompleteWithContextRequest,
  userId?: string,
): Promise<CompleteWithContextResult> {
  let lastErr: CompleteWithContextResult | null = null
  for (let attempt = 1; attempt <= UPSTREAM_RETRY_MAX; attempt++) {
    const result = await completeOnce(req, pluginId, userId)
    if (result.ok) return result
    const code = result.code
    if (PIPELINE_FATAL.has(code)) return result
    if (UPSTREAM_RETRY.has(code) && attempt < UPSTREAM_RETRY_MAX) {
      lastErr = result
      continue
    }
    return result
  }
  return lastErr ?? { ok: false, code: 'plugin_complete_failed' }
}

export function parseCompleteWithContextBody(
  body: unknown,
): CompleteWithContextRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const o = body as Record<string, unknown>
  const conversationId =
    typeof o.conversationId === 'string' ? o.conversationId.trim() : ''
  if (!conversationId) return null
  if (
    typeof o.anchorToTurn !== 'number' ||
    !Number.isInteger(o.anchorToTurn) ||
    o.anchorToTurn < 0
  ) {
    return null
  }
  const layout = parsePromptLayout(o.layout)
  if (!layout) return null

  let preparedContext: CompleteWithContextRequest['preparedContext']
  if (
    o.preparedContext &&
    typeof o.preparedContext === 'object' &&
    !Array.isArray(o.preparedContext)
  ) {
    const pc = o.preparedContext as Record<string, unknown>
    const metaRaw = pc.meta
    if (
      pc.blocks &&
      typeof pc.blocks === 'object' &&
      !Array.isArray(pc.blocks) &&
      metaRaw &&
      typeof metaRaw === 'object' &&
      !Array.isArray(metaRaw)
    ) {
      const meta = metaRaw as Record<string, unknown>
      const userDisplayName =
        typeof meta.userDisplayName === 'string' ? meta.userDisplayName : ''
      const assistantDisplayName =
        typeof meta.assistantDisplayName === 'string' ? meta.assistantDisplayName : ''
      if (userDisplayName && assistantDisplayName) {
        preparedContext = {
          blocks: pc.blocks as Record<string, string>,
          entriesByBlock:
            pc.entriesByBlock &&
            typeof pc.entriesByBlock === 'object' &&
            !Array.isArray(pc.entriesByBlock)
              ? (pc.entriesByBlock as Record<string, LorebookEntrySlice[]>)
              : {},
          meta: {
            userDisplayName,
            assistantDisplayName,
            ...(typeof meta.turnCount === 'number' ? { turnCount: meta.turnCount } : {}),
          },
        }
      }
    }
  }

  const blocks = parseContextBlockSpecs(o.blocks)
  if (!preparedContext && blocks.length === 0) return null

  let draft: CompleteWithContextDraftParse | undefined
  if (o.draft !== undefined && o.draft !== null) {
    if (typeof o.draft !== 'object' || Array.isArray(o.draft)) return null
    const d = o.draft as Record<string, unknown>
    const kind = typeof d.kind === 'string' ? d.kind.trim() : ''
    if (!kind) return null
    draft = { kind }
    if (typeof d.fromTurn === 'number') draft.fromTurn = d.fromTurn
    if (typeof d.toTurn === 'number') draft.toTurn = d.toTurn
    if (typeof d.blockTurns === 'number') draft.blockTurns = d.blockTurns
  }

  return {
    conversationId,
    blocks,
    layout,
    pluginSettings:
      o.pluginSettings && typeof o.pluginSettings === 'object' && !Array.isArray(o.pluginSettings)
        ? (o.pluginSettings as Record<string, unknown>)
        : undefined,
    anchorToTurn: o.anchorToTurn,
    apiConfigId: typeof o.apiConfigId === 'string' ? o.apiConfigId : undefined,
    responseFormat:
      o.responseFormat === 'text' ? 'text' : o.responseFormat === 'json_object' ? 'json_object' : undefined,
    dryRun: o.dryRun === true,
    preparedContext,
    draft,
    captureDebug: o.captureDebug === true,
    fallbackToGlobalDefault: o.fallbackToGlobalDefault !== false,
  }
}
