import { generateShortId } from './short-id.js'
import {
  readApiSettingsFromFile,
  writeApiSettingsToFile,
  type ApiSettingsDocument,
} from './api-settings-file.js'
import {
  bindingUniqueKey,
  findFeatureBinding,
  parseFeatureBinding,
  upsertChatGlobalBinding,
  validateFeatureBindingUniqueness,
  type FeatureBinding,
  type FeatureType,
} from './feature-binding-types.js'

export interface FeatureBindingPutInput {
  id?: string
  featureType: FeatureType
  featureRefId: string
  apiConfigId: string
  modelOverride?: string
  params?: Record<string, unknown>
}

export class FeatureBindingServiceError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

function parsePutInput(
  raw: unknown,
): { ok: true; input: FeatureBindingPutInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'feature_binding_invalid' }
  }
  const o = raw as Record<string, unknown>
  const featureType = o.featureType
  if (
    typeof featureType !== 'string' ||
    !['chat', 'rag_generate', 'rerank'].includes(
      featureType,
    )
  ) {
    return { ok: false, error: 'feature_binding_type_invalid' }
  }
  const featureRefId =
    typeof o.featureRefId === 'string' ? o.featureRefId.trim() : ''
  const apiConfigId =
    typeof o.apiConfigId === 'string' ? o.apiConfigId.trim() : ''
  if (!apiConfigId) {
    return { ok: false, error: 'feature_binding_api_config_invalid' }
  }
  const input: FeatureBindingPutInput = {
    featureType: featureType as FeatureType,
    featureRefId,
    apiConfigId,
  }
  if (typeof o.id === 'string' && o.id.trim()) {
    input.id = o.id.trim()
  }
  if (typeof o.modelOverride === 'string' && o.modelOverride.trim()) {
    input.modelOverride = o.modelOverride.trim()
  }
  if (
    o.params !== undefined &&
    o.params !== null &&
    typeof o.params === 'object' &&
    !Array.isArray(o.params)
  ) {
    input.params = o.params as Record<string, unknown>
  }
  const probe = parseFeatureBinding({
    id: input.id ?? generateShortId(),
    featureType: input.featureType,
    featureRefId: input.featureRefId,
    apiConfigId: input.apiConfigId,
    modelOverride: input.modelOverride,
    params: input.params,
    updatedAt: new Date().toISOString(),
  })
  if (!probe.ok) return { ok: false, error: probe.error }
  return { ok: true, input }
}

function upsertBindingList(
  existing: FeatureBinding[],
  incoming: FeatureBindingPutInput,
  now: string,
): FeatureBinding[] {
  const key = bindingUniqueKey(incoming.featureType, incoming.featureRefId)
  const idx = existing.findIndex(
    (b) => bindingUniqueKey(b.featureType, b.featureRefId) === key,
  )
  const next: FeatureBinding = {
    id:
      incoming.id?.trim() ||
      (idx >= 0 ? existing[idx]!.id : generateShortId()),
    featureType: incoming.featureType,
    featureRefId: incoming.featureRefId.trim(),
    apiConfigId: incoming.apiConfigId.trim(),
    updatedAt: now,
  }
  if (incoming.modelOverride?.trim()) {
    next.modelOverride = incoming.modelOverride.trim()
  }
  if (incoming.params) {
    next.params = incoming.params
  }
  if (idx >= 0) {
    const copy = [...existing]
    copy[idx] = next
    return copy
  }
  return [...existing, next]
}

function assertPresetExists(
  settings: ApiSettingsDocument,
  apiConfigId: string,
): void {
  if (!settings.presets.some((p) => p.id === apiConfigId)) {
    throw new FeatureBindingServiceError('api_preset_not_found')
  }
}

export async function listFeatureBindings(): Promise<FeatureBinding[]> {
  const settings = await readApiSettingsFromFile()
  return settings?.featureBindings ?? []
}

export async function mergeFeatureBindingsPut(
  rawBindings: unknown[],
): Promise<{
  bindings: FeatureBinding[]
  activePresetId: string
  savedAt: string
}> {
  const settings = await readApiSettingsFromFile()
  if (!settings) {
    throw new FeatureBindingServiceError('settings_read_failed')
  }
  if (!Array.isArray(rawBindings) || rawBindings.length === 0) {
    throw new FeatureBindingServiceError('feature_bindings_empty')
  }

  const now = new Date().toISOString()
  let bindings = [...(settings.featureBindings ?? [])]

  for (const raw of rawBindings) {
    const parsed = parsePutInput(raw)
    if (!parsed.ok) {
      throw new FeatureBindingServiceError(parsed.error)
    }
    assertPresetExists(settings, parsed.input.apiConfigId)
    bindings = upsertBindingList(bindings, parsed.input, now)
  }

  const unique = validateFeatureBindingUniqueness(bindings)
  if (!unique.ok) {
    throw new FeatureBindingServiceError(unique.error)
  }

  const chat = findFeatureBinding(bindings, 'chat', 'global')
  let activePresetId = settings.activePresetId
  if (chat) {
    activePresetId = chat.apiConfigId
    bindings = upsertChatGlobalBinding(bindings, activePresetId, now)
  }

  const doc: ApiSettingsDocument = {
    ...settings,
    savedAt: now,
    activePresetId,
    featureBindings: bindings,
  }
  await writeApiSettingsToFile(doc)
  const refreshed = await readApiSettingsFromFile()
  return {
    bindings: refreshed?.featureBindings ?? bindings,
    activePresetId: refreshed?.activePresetId ?? activePresetId,
    savedAt: refreshed?.savedAt ?? now,
  }
}

export async function deleteFeatureBindingById(
  bindingId: string,
): Promise<{
  bindings: FeatureBinding[]
  activePresetId: string
  savedAt: string
}> {
  const settings = await readApiSettingsFromFile()
  if (!settings) {
    throw new FeatureBindingServiceError('settings_read_failed')
  }
  const id = bindingId.trim()
  const hit = (settings.featureBindings ?? []).find((b) => b.id === id)
  if (!hit) {
    throw new FeatureBindingServiceError('feature_binding_not_found')
  }

  const now = new Date().toISOString()
  let bindings = (settings.featureBindings ?? []).filter((b) => b.id !== id)
  let activePresetId = settings.activePresetId

  if (hit.featureType === 'chat' && hit.featureRefId === 'global') {
    activePresetId = settings.presets[0]?.id ?? activePresetId
    bindings = upsertChatGlobalBinding(bindings, activePresetId, now)
  }

  const doc: ApiSettingsDocument = {
    ...settings,
    savedAt: now,
    activePresetId,
    featureBindings: bindings,
  }
  await writeApiSettingsToFile(doc)
  const refreshed = await readApiSettingsFromFile()
  return {
    bindings: refreshed?.featureBindings ?? bindings,
    activePresetId: refreshed?.activePresetId ?? activePresetId,
    savedAt: refreshed?.savedAt ?? now,
  }
}

export function mergeFeatureBindingsIntoSettingsPut(
  existing: FeatureBinding[] | undefined,
  incoming: unknown,
  activePresetId: string,
  savedAt: string,
): FeatureBinding[] {
  if (incoming === undefined) {
    return upsertChatGlobalBinding(existing ?? [], activePresetId, savedAt)
  }
  if (!Array.isArray(incoming)) {
    throw new Error('feature_bindings_invalid')
  }
  let bindings = [...(existing ?? [])]
  for (const raw of incoming) {
    const parsed = parsePutInput(raw)
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    bindings = upsertBindingList(bindings, parsed.input, savedAt)
  }
  const unique = validateFeatureBindingUniqueness(bindings)
  if (!unique.ok) {
    throw new Error(unique.error)
  }
  return upsertChatGlobalBinding(bindings, activePresetId, savedAt)
}
