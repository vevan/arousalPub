import { appendDrySamplerToPayload } from './dry-sampler.js'
import type { ApiPreset } from './api-settings-file.js'

export interface PluginUpstreamMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 插件出站补全：对齐预设采样参数，默认关闭思维链，response_format 最后写入以免被 customParams 覆盖 */
export function buildPluginCompleteUpstreamPayload(opts: {
  preset: ApiPreset
  model: string
  messages: PluginUpstreamMessage[]
  responseFormat?: 'json_object' | 'text'
}): Record<string, unknown> {
  const { preset, model, messages, responseFormat } = opts

  const payload: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    thinking: { type: 'disabled' },
  }

  if (preset.temperature != null) payload.temperature = preset.temperature
  if (preset.topP != null) payload.top_p = preset.topP
  if (preset.topK != null) payload.top_k = preset.topK
  if (preset.frequencyPenalty != null) {
    payload.frequency_penalty = preset.frequencyPenalty
  }
  if (preset.presencePenalty != null) {
    payload.presence_penalty = preset.presencePenalty
  }
  if (preset.maxTokens != null) payload.max_tokens = preset.maxTokens
  if (preset.contextLength != null) payload.context_length = preset.contextLength

  appendDrySamplerToPayload(payload, preset)

  if (preset.customParamsJson?.trim()) {
    try {
      const custom = JSON.parse(preset.customParamsJson) as unknown
      if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
        Object.assign(payload, custom)
      }
    } catch {
      /* 忽略非法 customParams */
    }
  }

  // 插件任务默认关思维链；customParams 之后再次强制，避免被覆盖
  payload.thinking = { type: 'disabled' }

  if (responseFormat === 'json_object') {
    payload.response_format = { type: 'json_object' }
  }

  return payload
}
