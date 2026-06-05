import { existsSync } from 'node:fs'
import { getApiSettingsPath } from './config.js'
import {
  newApiPresetId,
  writeApiSettingsToFile,
  type ApiPreset,
  type ApiSettingsDocument,
} from './api-settings-file.js'
import { runRequestUser } from './user-context.js'

function buildDefaultApiPreset(id: string): ApiPreset {
  return {
    id,
    alias: '默认',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    contextLength: null,
    maxTokens: null,
    stream: false,
    temperature: 0.7,
    topP: null,
    topK: null,
    dryMultiplier: null,
    dryBase: null,
    dryAllowedLength: null,
    dryPenaltyLastN: null,
    drySequenceBreakers: [],
    frequencyPenalty: null,
    presencePenalty: null,
    customParamsJson: '',
    showReasoningChain: true,
    requestReasoningChain: false,
    linkedPromptPresetId: null,
    apiKeyId: null,
  }
}

/** 新用户目录：无 api-settings.json 时写入一条默认 API 预设 */
export async function seedDefaultApiSettingsForUser(
  userId: string,
): Promise<boolean> {
  if (existsSync(getApiSettingsPath(userId))) return false
  const id = newApiPresetId()
  const savedAt = new Date().toISOString()
  const doc: ApiSettingsDocument = {
    version: 1,
    savedAt,
    activePresetId: id,
    presets: [buildDefaultApiPreset(id)],
  }
  await runRequestUser(userId, () => writeApiSettingsToFile(doc))
  return true
}
