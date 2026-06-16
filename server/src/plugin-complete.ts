import {
  ApiCredentialError,
  normalizeChatBaseUrl,
  resolveApiKeyFromPreset,
} from './api-credential-resolve.js'
import { readApiSettingsFromFile } from './api-settings-file.js'
import { buildPluginCompleteUpstreamPayload } from './plugin-upstream-payload.js'
import { extractAssistantContent } from './upstream-chat.js'

export interface PluginCompleteMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface PluginCompleteDebugCapture {
  messages: PluginCompleteMessage[]
  upstreamPayload?: unknown
  upstreamStatus?: number
  upstreamRawBody?: string
  assistantContent?: string
}

export interface PluginCompleteRequest {
  apiConfigId: string
  messages: PluginCompleteMessage[]
  modelOverride?: string
  stream?: boolean
  responseFormat?: 'json_object' | 'text'
  /** 会话 auditDebug 开启时由宿主传入，失败响应附带 debug */
  captureDebug?: boolean
}

export interface PluginCompleteSuccess {
  ok: true
  content: string
  usage?: { promptTokens?: number; completionTokens?: number }
  latencyMs: number
  debug?: PluginCompleteDebugCapture
}

export interface PluginCompleteFailure {
  ok: false
  code: string
  status?: number
  detail?: string
  debug?: PluginCompleteDebugCapture
}

const DEBUG_RAW_BODY_MAX = 8192

function debugCapture(
  req: PluginCompleteRequest,
  msgs: PluginCompleteMessage[],
  partial: Omit<PluginCompleteDebugCapture, 'messages'>,
): PluginCompleteDebugCapture | undefined {
  if (!req.captureDebug) return undefined
  return { messages: msgs, ...partial }
}

function withDebug(
  req: PluginCompleteRequest,
  msgs: PluginCompleteMessage[],
  failure: Omit<PluginCompleteFailure, 'debug'>,
  partial: Omit<PluginCompleteDebugCapture, 'messages' | 'code'>,
): PluginCompleteFailure {
  const debug = debugCapture(req, msgs, partial)
  return debug ? { ...failure, debug } : failure
}

function validateMessages(
  messages: unknown,
): { ok: true; msgs: PluginCompleteMessage[] } | { ok: false; code: string } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, code: 'messages_empty' }
  }
  for (const m of messages) {
    if (
      !m ||
      typeof (m as PluginCompleteMessage).content !== 'string' ||
      !['system', 'user', 'assistant'].includes((m as PluginCompleteMessage).role)
    ) {
      return { ok: false, code: 'messages_invalid' }
    }
  }
  return { ok: true, msgs: messages as PluginCompleteMessage[] }
}

function extractUsage(json: unknown): PluginCompleteSuccess['usage'] | undefined {
  if (!json || typeof json !== 'object') return undefined
  const usage = (json as { usage?: unknown }).usage
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const promptTokens =
    typeof u.prompt_tokens === 'number' ? u.prompt_tokens : undefined
  const completionTokens =
    typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined
  if (promptTokens === undefined && completionTokens === undefined) {
    return undefined
  }
  return { promptTokens, completionTokens }
}

export async function runPluginComplete(
  req: PluginCompleteRequest,
): Promise<PluginCompleteSuccess | PluginCompleteFailure> {
  if (req.stream === true) {
    return { ok: false, code: 'stream_not_supported' }
  }

  const apiConfigId = typeof req.apiConfigId === 'string' ? req.apiConfigId.trim() : ''
  if (!apiConfigId) {
    return { ok: false, code: 'api_config_not_found' }
  }

  const msgCheck = validateMessages(req.messages)
  if (!msgCheck.ok) {
    return { ok: false, code: msgCheck.code }
  }

  const settings = await readApiSettingsFromFile()
  if (!settings) {
    return { ok: false, code: 'api_credential_not_configured' }
  }

  const preset = settings.presets.find((p) => p.id === apiConfigId) ?? null
  if (!preset) {
    return { ok: false, code: 'api_config_not_found' }
  }

  let apiKey = ''
  try {
    apiKey = await resolveApiKeyFromPreset(preset)
  } catch (e) {
    if (e instanceof ApiCredentialError) {
      return { ok: false, code: e.code }
    }
    throw e
  }
  if (!apiKey) {
    return { ok: false, code: 'api_credential_not_configured' }
  }

  const model = (req.modelOverride?.trim() || preset.model || '').trim()
  if (!model) {
    return { ok: false, code: 'missing_model' }
  }

  const baseUrl = normalizeChatBaseUrl(preset.baseUrl)
  const requestUrl = `${baseUrl}/chat/completions`
  const started = Date.now()

  const payload = buildPluginCompleteUpstreamPayload({
    preset,
    model,
    messages: msgCheck.msgs,
    responseFormat: req.responseFormat,
  })

  const { fetchWithTimeout } = await import('./fetch-with-timeout.js')
  const upstream = await fetchWithTimeout(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  const latencyMs = Date.now() - started
  const text = await upstream.text()
  const rawSnippet = text.slice(0, DEBUG_RAW_BODY_MAX)

  if (!upstream.ok) {
    return withDebug(req, msgCheck.msgs, {
      ok: false,
      code: 'upstream_error',
      status: upstream.status,
      detail: text.slice(0, 2000),
    }, {
      upstreamPayload: payload,
      upstreamStatus: upstream.status,
      upstreamRawBody: rawSnippet,
    })
  }

  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    return withDebug(req, msgCheck.msgs, {
      ok: false,
      code: 'upstream_non_json',
      detail: text.slice(0, 500),
    }, {
      upstreamPayload: payload,
      upstreamStatus: upstream.status,
      upstreamRawBody: rawSnippet,
    })
  }

  const content = extractAssistantContent(json)
  if (!content) {
    return withDebug(req, msgCheck.msgs, {
      ok: false,
      code: 'upstream_empty_content',
      detail: text.slice(0, 500),
    }, {
      upstreamPayload: payload,
      upstreamStatus: upstream.status,
      upstreamRawBody: rawSnippet,
    })
  }

  return {
    ok: true,
    content,
    usage: extractUsage(json),
    latencyMs,
    ...(req.captureDebug
      ? {
          debug: {
            messages: msgCheck.msgs,
            upstreamPayload: payload,
            upstreamStatus: upstream.status,
            upstreamRawBody: rawSnippet,
            assistantContent: content,
          },
        }
      : {}),
  }
}
