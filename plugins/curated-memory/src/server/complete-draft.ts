import {
  formatEntryTitle,
  normalizeSummaryPayload,
  parseModelJson,
} from '../shared/summarize.js'
import { asString } from '../shared/utils.js'

const UPSTREAM_RETRY_MAX = 3
const PIPELINE_FATAL = new Set(['context_exceeded', 'context_length_unconfigured'])
const UPSTREAM_RETRY = new Set(['plugin_complete_failed', 'preflight_failed'])

type DraftApi = {
  runPluginComplete: (req: {
    apiConfigId?: string
    conversationId?: string
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    responseFormat?: 'json_object' | 'text'
  }) => Promise<
    | { ok: true; content: string; usage?: { promptTokens?: number; completionTokens?: number }; latencyMs: number }
    | { ok: false; code: string }
  >
  runPluginCompletePreflight: (req: {
    apiConfigId?: string
    conversationId?: string
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  }) => Promise<{ ok: boolean; code?: string; promptTokens: number; budget: number }>
  runPluginMacroExpand: (req: {
    text: string
    conversationId?: string
    apiConfigId?: string
  }) => Promise<string>
}

async function expandText(
  api: DraftApi,
  text: string,
  conversationId: string,
  apiConfigId: string,
): Promise<string> {
  const raw = asString(text)
  if (!raw.includes('{{')) return raw
  return api.runPluginMacroExpand({ text: raw, conversationId, apiConfigId })
}

async function assertPreflight(
  api: DraftApi,
  conversationId: string,
  apiConfigId: string | undefined,
  system: string,
  userContent: string,
): Promise<void> {
  const pf = await api.runPluginCompletePreflight({
    apiConfigId,
    conversationId,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  })
  if (pf.ok) return
  if (pf.code === 'context_exceeded') {
    const err = new Error('context_exceeded') as Error & {
      promptTokens?: number
      budget?: number
    }
    err.promptTokens = pf.promptTokens
    err.budget = pf.budget
    throw err
  }
  if (pf.code === 'context_length_unconfigured') {
    throw new Error('context_length_unconfigured')
  }
  throw new Error('preflight_failed')
}

async function callCompleteOnce(
  api: DraftApi,
  conversationId: string,
  apiConfigId: string | undefined,
  system: string,
  userContent: string,
) {
  const [expandedSystem, expandedUser] = await Promise.all([
    expandText(api, system, conversationId, apiConfigId ?? ''),
    expandText(api, userContent, conversationId, apiConfigId ?? ''),
  ])
  await assertPreflight(
    api,
    conversationId,
    apiConfigId,
    expandedSystem,
    expandedUser,
  )
  const result = await api.runPluginComplete({
    apiConfigId,
    conversationId,
    messages: [
      { role: 'system', content: expandedSystem },
      { role: 'user', content: expandedUser },
    ],
    responseFormat: 'json_object',
  })
  if (!result.ok) {
    throw new Error(result.code || 'plugin_complete_failed')
  }
  return result
}

async function callCompleteWithRetry(
  api: DraftApi,
  conversationId: string,
  apiConfigId: string | undefined,
  system: string,
  userContent: string,
) {
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= UPSTREAM_RETRY_MAX; attempt++) {
    try {
      return await callCompleteOnce(api, conversationId, apiConfigId, system, userContent)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (PIPELINE_FATAL.has(msg)) throw e
      if (UPSTREAM_RETRY.has(msg) && attempt < UPSTREAM_RETRY_MAX) {
        lastErr = e
        continue
      }
      throw e
    }
  }
  throw lastErr ?? new Error('plugin_complete_failed')
}

export async function completeDraft(
  ctx: {
    pluginId: string
    conversationId: string
    apiConfigId?: string
    kind: 'memory' | 'sidecar'
    userContent: string
    systemPromptTemplate: string
    fromTurn?: number
    toTurn?: number
    sidecarName?: string
  },
  api: DraftApi,
) {
  const result = await callCompleteWithRetry(
    api,
    ctx.conversationId,
    ctx.apiConfigId,
    ctx.systemPromptTemplate,
    ctx.userContent,
  )
  const raw = parseModelJson(result.content)

  if (ctx.kind === 'sidecar') {
    const parsed = raw as Record<string, unknown>
    const sidecar = normalizeSummaryPayload({
      title: ctx.sidecarName || asString(parsed.title),
      content: parsed.content ?? parsed.title,
      keywords: parsed.keywords,
    })
    return {
      draft: {
        title: ctx.sidecarName || sidecar.title,
        content: sidecar.content,
        keywords: sidecar.keywords,
      },
      usage: result.usage,
      latencyMs: result.latencyMs,
    }
  }

  const summary = normalizeSummaryPayload(raw)
  const fromTurn = typeof ctx.fromTurn === 'number' ? ctx.fromTurn : 0
  const toTurn = typeof ctx.toTurn === 'number' ? ctx.toTurn : fromTurn
  const entryTitle = formatEntryTitle(summary.title, fromTurn, toTurn)
  return {
    draft: {
      title: entryTitle,
      content: summary.content,
      keywords: summary.keywords,
    },
    usage: result.usage,
    latencyMs: result.latencyMs,
  }
}
