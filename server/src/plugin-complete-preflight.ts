import { readApiSettingsFromFile } from './api-settings-file.js'
import {
  countChatMessagesTokens,
  encodingNameForModel,
  type TiktokenEncodingName,
} from './token-count.js'
import type { PluginCompleteMessage } from './plugin-complete.js'

const DEFAULT_OUTPUT_RESERVE = 2048

export interface PluginCompletePreflightRequest {
  apiConfigId: string
  messages: PluginCompleteMessage[]
}

export interface PluginCompletePreflightResult {
  ok: boolean
  promptTokens: number
  budget: number
  contextLength: number | null
  outputReserve: number
  model: string | null
  encoding: TiktokenEncodingName
  code?: 'context_exceeded' | 'context_length_unconfigured' | 'api_config_not_found' | 'messages_empty' | 'messages_invalid'
}

function validateMessages(
  messages: unknown,
): { ok: true; msgs: PluginCompleteMessage[] } | { ok: false; code: 'messages_empty' | 'messages_invalid' } {
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

export async function runPluginCompletePreflight(
  req: PluginCompletePreflightRequest,
): Promise<PluginCompletePreflightResult> {
  const apiConfigId = typeof req.apiConfigId === 'string' ? req.apiConfigId.trim() : ''
  const msgCheck = validateMessages(req.messages)
  if (!msgCheck.ok) {
    return {
      ok: false,
      promptTokens: 0,
      budget: 0,
      contextLength: null,
      outputReserve: DEFAULT_OUTPUT_RESERVE,
      model: null,
      encoding: 'o200k_base',
      code: msgCheck.code,
    }
  }

  if (!apiConfigId) {
    return {
      ok: false,
      promptTokens: 0,
      budget: 0,
      contextLength: null,
      outputReserve: DEFAULT_OUTPUT_RESERVE,
      model: null,
      encoding: 'o200k_base',
      code: 'api_config_not_found',
    }
  }

  const settings = await readApiSettingsFromFile()
  const preset = settings?.presets.find((p) => p.id === apiConfigId) ?? null
  if (!preset) {
    return {
      ok: false,
      promptTokens: 0,
      budget: 0,
      contextLength: null,
      outputReserve: DEFAULT_OUTPUT_RESERVE,
      model: null,
      encoding: 'o200k_base',
      code: 'api_config_not_found',
    }
  }

  const model = (preset.model || '').trim() || null
  const encoding = encodingNameForModel(model ?? undefined)
  const promptTokens = countChatMessagesTokens(msgCheck.msgs, { model: model ?? undefined })
  const contextLength =
    typeof preset.contextLength === 'number' && preset.contextLength > 0
      ? preset.contextLength
      : null
  const outputReserve =
    typeof preset.maxTokens === 'number' && preset.maxTokens > 0
      ? preset.maxTokens
      : DEFAULT_OUTPUT_RESERVE

  if (contextLength == null) {
    return {
      ok: false,
      promptTokens,
      budget: 0,
      contextLength: null,
      outputReserve,
      model,
      encoding,
      code: 'context_length_unconfigured',
    }
  }

  const budget = Math.max(0, contextLength - outputReserve)
  const ok = promptTokens <= budget
  return {
    ok,
    promptTokens,
    budget,
    contextLength,
    outputReserve,
    model,
    encoding,
    code: ok ? undefined : 'context_exceeded',
  }
}
