import {
  ApiCredentialError,
  normalizeChatBaseUrl,
  resolveChatCredentials,
} from './api-credential-resolve.js'
import {
  fetchUpstreamChatCompletion,
} from './upstream-chat.js'
import { fetchUpstreamModelsList } from './upstream-models.js'

export interface ApiPresetTestPhaseModels {
  ok: true
  requestUrl: string
  latencyMs: number
  modelCount: number
  sampleModels: string[]
}

export interface ApiPresetTestPhaseChat {
  ok: true
  requestUrl: string
  latencyMs: number
  model: string
  replyPreview: string
  replyWarning?: 'truncated'
}

export interface ApiPresetTestInput {
  apiPresetId: string
  baseUrl?: string | null
  /** 覆盖 preset 磁盘上的 model；缺省用 preset.model */
  model?: string | null
}

export interface ApiPresetTestSuccess {
  ok: true
  phases: {
    models: ApiPresetTestPhaseModels
    chat: ApiPresetTestPhaseChat
  }
  totalLatencyMs: number
}

export interface ApiPresetTestFailure {
  ok: false
  phase: 'models' | 'chat'
  error: string
  requestUrl?: string
  latencyMs?: number
  status?: number
  detail?: string
  /** 模型列表阶段已成功时附带，便于 UI 展示部分进度 */
  models?: ApiPresetTestPhaseModels
  model?: string
}

export async function testApiPresetConnectivity(
  input: ApiPresetTestInput,
): Promise<ApiPresetTestSuccess | ApiPresetTestFailure> {
  const presetId = input.apiPresetId.trim()
  if (!presetId) {
    return { ok: false, phase: 'models', error: 'invalid_id' }
  }

  let creds
  try {
    creds = await resolveChatCredentials({
      apiPresetId: presetId,
      baseUrl: input.baseUrl,
    })
  } catch (e) {
    if (e instanceof ApiCredentialError) {
      return { ok: false, phase: 'models', error: e.code }
    }
    throw e
  }

  if (!creds.apiKey.trim()) {
    return { ok: false, phase: 'models', error: 'missing_api_key' }
  }

  const baseUrl = normalizeChatBaseUrl(input.baseUrl ?? creds.baseUrl)
  const modelOverride =
    typeof input.model === 'string' ? input.model.trim() : ''
  const model = modelOverride || creds.preset?.model?.trim() || ''
  if (!model) {
    return { ok: false, phase: 'chat', error: 'missing_model' }
  }

  const totalStarted = Date.now()

  const modelsResult = await fetchUpstreamModelsList({
    baseUrl,
    apiKey: creds.apiKey,
  })

  if (!modelsResult.ok) {
    return {
      ok: false,
      phase: 'models',
      error: 'models_list_failed',
      requestUrl: modelsResult.requestUrl,
      latencyMs: modelsResult.latencyMs,
      status: modelsResult.status,
      detail: modelsResult.detail,
    }
  }

  const modelsPhase: ApiPresetTestPhaseModels = {
    ok: true,
    requestUrl: modelsResult.requestUrl,
    latencyMs: modelsResult.latencyMs,
    modelCount: modelsResult.models.length,
    sampleModels: modelsResult.models.slice(0, 5),
  }

  const chatResult = await fetchUpstreamChatCompletion({
    baseUrl,
    apiKey: creds.apiKey,
    model,
  })

  if (!chatResult.ok) {
    return {
      ok: false,
      phase: 'chat',
      error: 'api_preset_chat_test_failed',
      requestUrl: chatResult.requestUrl,
      latencyMs: chatResult.latencyMs,
      status: chatResult.status,
      detail: chatResult.detail,
      models: modelsPhase,
      model,
    }
  }

  return {
    ok: true,
    phases: {
      models: modelsPhase,
      chat: {
        ok: true,
        requestUrl: chatResult.requestUrl,
        latencyMs: chatResult.latencyMs,
        model: chatResult.model,
        replyPreview: chatResult.replyPreview,
        replyWarning: chatResult.replyWarning,
      },
    },
    totalLatencyMs: Date.now() - totalStarted,
  }
}
