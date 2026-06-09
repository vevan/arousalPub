import {
  readApiKeysDocument,
  type ApiKeyEntry,
} from './api-keys-file.js'
import {
  readApiSettingsFromFile,
  type ApiPreset,
} from './api-settings-file.js'
import { resolveUpstreamUrlPolicy } from './config.js'
import { resolveChatApiConfigId } from './feature-binding-resolve.js'
import {
  assertUpstreamBaseUrlAllowed,
  UpstreamUrlBlockedError,
} from './upstream-url-guard.js'

const DEFAULT_BASE = 'https://api.openai.com/v1'

export class ApiCredentialError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

export function normalizeChatBaseUrl(raw: string | undefined): string {
  const s = (raw ?? DEFAULT_BASE).trim().replace(/\/+$/, '')
  const base = s || DEFAULT_BASE
  try {
    assertUpstreamBaseUrlAllowed(base, resolveUpstreamUrlPolicy())
  } catch (e) {
    if (e instanceof UpstreamUrlBlockedError) {
      throw new ApiCredentialError(e.code)
    }
    throw e
  }
  return base
}

export async function resolveKeyFromKeychain(keyId: string): Promise<string> {
  const doc = await readApiKeysDocument()
  const hit = doc?.keys.find((k) => k.id === keyId)
  return hit?.key?.trim() ?? ''
}

export async function resolveApiKeyFromPreset(preset: ApiPreset): Promise<string> {
  const keyId = preset.apiKeyId?.trim()
  if (keyId) {
    const fromChain = await resolveKeyFromKeychain(keyId)
    if (fromChain) return fromChain
  }
  return preset.apiKey?.trim() ?? ''
}

export async function isApiKeyConfiguredForPreset(
  preset: ApiPreset,
): Promise<boolean> {
  const key = await resolveApiKeyFromPreset(preset)
  return key.length > 0
}

export function isApiKeyConfiguredForEntry(entry: ApiKeyEntry): boolean {
  return Boolean(entry.key?.trim())
}

export interface ResolveChatCredentialsInput {
  apiPresetId?: string | null
  apiKeyId?: string | null
  baseUrl?: string | null
}

export interface ResolvedChatCredentials {
  baseUrl: string
  apiKey: string
  preset: ApiPreset | null
  presetId: string | null
}

/** 对话 / 拉模型：按 preset + keychain 读盘解析 Authorization */
export async function resolveChatCredentials(
  input: ResolveChatCredentialsInput,
): Promise<ResolvedChatCredentials> {
  const settings = await readApiSettingsFromFile()
  if (!settings) {
    throw new ApiCredentialError('api_credential_not_configured')
  }

  const resolvedChat = resolveChatApiConfigId(settings)
  const presetId = (
    input.apiPresetId?.trim() ||
    resolvedChat?.apiConfigId ||
    settings.activePresetId ||
    ''
  ).trim()
  const preset = settings.presets.find((p) => p.id === presetId) ?? null

  let apiKey = ''
  const overrideKeyId = input.apiKeyId?.trim()
  if (overrideKeyId) {
    apiKey = await resolveKeyFromKeychain(overrideKeyId)
  } else if (preset) {
    apiKey = await resolveApiKeyFromPreset(preset)
  }

  if (!apiKey) {
    throw new ApiCredentialError('api_credential_not_configured')
  }

  const baseUrl = normalizeChatBaseUrl(
    input.baseUrl?.trim() || preset?.baseUrl?.trim() || undefined,
  )

  return {
    baseUrl,
    apiKey,
    preset,
    presetId: preset?.id ?? (presetId || null),
  }
}
