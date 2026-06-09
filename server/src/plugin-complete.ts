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

export interface PluginCompleteRequest {
  apiConfigId: string
  messages: PluginCompleteMessage[]
  modelOverride?: string
  stream?: boolean
  responseFormat?: 'json_object' | 'text'
}

export interface PluginCompleteSuccess {
  ok: true
  content: string
  usage?: { promptTokens?: number; completionTokens?: number }
  latencyMs: number
}

export interface PluginCompleteFailure {
  ok: false
  code: string
  status?: number
  detail?: string
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

  if (!upstream.ok) {
    return {
      ok: false,
      code: 'upstream_error',
      status: upstream.status,
      detail: text.slice(0, 2000),
    }
  }

  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    return { ok: false, code: 'upstream_non_json', detail: text.slice(0, 500) }
  }

  const content = extractAssistantContent(json)
  if (!content) {
    return { ok: false, code: 'upstream_empty_content', detail: text.slice(0, 500) }
  }

  return {
    ok: true,
    content,
    usage: extractUsage(json),
    latencyMs,
  }
}
