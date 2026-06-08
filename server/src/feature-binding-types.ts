import { generateShortId } from './short-id.js'

export const FEATURE_TYPES = [
  'chat',
  'rag_generate',
  'rerank',
] as const

export type FeatureType = (typeof FEATURE_TYPES)[number]

export interface FeatureBinding {
  id: string
  featureType: FeatureType
  featureRefId: string
  apiConfigId: string
  modelOverride?: string
  params?: Record<string, unknown>
  updatedAt: string
}

const NON_PLUGIN_GLOBAL_REF = 'global'

export function isFeatureType(v: unknown): v is FeatureType {
  return typeof v === 'string' && (FEATURE_TYPES as readonly string[]).includes(v)
}

export function bindingUniqueKey(
  featureType: FeatureType,
  featureRefId: string,
): string {
  return `${featureType}\0${featureRefId}`
}

export function expectedFeatureRefId(
  featureType: FeatureType,
  featureRefId: string,
): boolean {
  const ref = featureRefId.trim()
  if (!ref) return false
  return ref === NON_PLUGIN_GLOBAL_REF
}

export function parseFeatureBinding(
  raw: unknown,
): { ok: true; binding: FeatureBinding } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'feature_binding_invalid' }
  }
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id.trim()) {
    return { ok: false, error: 'feature_binding_id_invalid' }
  }
  if (!isFeatureType(o.featureType)) {
    return { ok: false, error: 'feature_binding_type_invalid' }
  }
  const featureRefId =
    typeof o.featureRefId === 'string' ? o.featureRefId.trim() : ''
  if (!expectedFeatureRefId(o.featureType, featureRefId)) {
    return { ok: false, error: 'feature_binding_ref_invalid' }
  }
  if (typeof o.apiConfigId !== 'string' || !o.apiConfigId.trim()) {
    return { ok: false, error: 'feature_binding_api_config_invalid' }
  }
  if (typeof o.updatedAt !== 'string' || !o.updatedAt.trim()) {
    return { ok: false, error: 'feature_binding_updated_at_invalid' }
  }
  const binding: FeatureBinding = {
    id: o.id.trim(),
    featureType: o.featureType,
    featureRefId,
    apiConfigId: o.apiConfigId.trim(),
    updatedAt: o.updatedAt.trim(),
  }
  if (typeof o.modelOverride === 'string' && o.modelOverride.trim()) {
    binding.modelOverride = o.modelOverride.trim()
  }
  if (
    o.params !== undefined &&
    o.params !== null &&
    typeof o.params === 'object' &&
    !Array.isArray(o.params)
  ) {
    binding.params = o.params as Record<string, unknown>
  }
  return { ok: true, binding }
}

export function parseFeatureBindingsFromDisk(
  raw: unknown,
): FeatureBinding[] {
  if (!Array.isArray(raw)) return []
  const out: FeatureBinding[] = []
  for (const item of raw) {
    const parsed = parseFeatureBinding(item)
    if (!parsed.ok) continue
    out.push(parsed.binding)
  }
  return out
}

export function validateFeatureBindingUniqueness(
  bindings: FeatureBinding[],
): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>()
  for (const b of bindings) {
    const key = bindingUniqueKey(b.featureType, b.featureRefId)
    if (seen.has(key)) {
      return { ok: false, error: 'feature_binding_duplicate' }
    }
    seen.add(key)
  }
  return { ok: true }
}

export function findFeatureBinding(
  bindings: FeatureBinding[],
  featureType: FeatureType,
  featureRefId: string,
): FeatureBinding | null {
  const ref = featureRefId.trim()
  return (
    bindings.find(
      (b) => b.featureType === featureType && b.featureRefId === ref,
    ) ?? null
  )
}

export function findChatGlobalBinding(
  bindings: FeatureBinding[],
): FeatureBinding | null {
  return findFeatureBinding(bindings, 'chat', NON_PLUGIN_GLOBAL_REF)
}

export function ensureChatBindingFromActivePreset(
  bindings: FeatureBinding[],
  activePresetId: string,
  now = new Date().toISOString(),
): FeatureBinding[] {
  const active = activePresetId.trim()
  if (!active) return bindings
  const existing = findChatGlobalBinding(bindings)
  if (existing) return bindings
  return [
    ...bindings,
    {
      id: generateShortId(),
      featureType: 'chat',
      featureRefId: NON_PLUGIN_GLOBAL_REF,
      apiConfigId: active,
      updatedAt: now,
    },
  ]
}

export function upsertChatGlobalBinding(
  bindings: FeatureBinding[],
  apiConfigId: string,
  now = new Date().toISOString(),
): FeatureBinding[] {
  const configId = apiConfigId.trim()
  if (!configId) return bindings
  const idx = bindings.findIndex(
    (b) => b.featureType === 'chat' && b.featureRefId === NON_PLUGIN_GLOBAL_REF,
  )
  if (idx >= 0) {
    const next = [...bindings]
    next[idx] = {
      ...next[idx],
      apiConfigId: configId,
      updatedAt: now,
    }
    return next
  }
  return [
    ...bindings,
    {
      id: generateShortId(),
      featureType: 'chat',
      featureRefId: NON_PLUGIN_GLOBAL_REF,
      apiConfigId: configId,
      updatedAt: now,
    },
  ]
}

/** 读盘：补 chat binding；以 binding 校正 activePresetId */
export function normalizeFeatureBindingsOnRead(
  bindings: FeatureBinding[],
  activePresetId: string,
  validPresetIds: Set<string>,
  now = new Date().toISOString(),
): { bindings: FeatureBinding[]; activePresetId: string } {
  let nextBindings = ensureChatBindingFromActivePreset(
    bindings,
    activePresetId,
    now,
  )
  let nextActive = activePresetId.trim()
  if (!validPresetIds.has(nextActive) && validPresetIds.size > 0) {
    nextActive = [...validPresetIds][0] ?? nextActive
  }

  const chat = findChatGlobalBinding(nextBindings)
  if (chat && validPresetIds.has(chat.apiConfigId)) {
    nextActive = chat.apiConfigId
  } else if (chat && validPresetIds.has(nextActive)) {
    nextBindings = upsertChatGlobalBinding(nextBindings, nextActive, now)
  }

  return { bindings: nextBindings, activePresetId: nextActive }
}

/** 写盘：activePresetId 与 chat/global binding 双写一致 */
export function syncActivePresetWithChatBinding(
  bindings: FeatureBinding[],
  activePresetId: string,
  now = new Date().toISOString(),
): { bindings: FeatureBinding[]; activePresetId: string } {
  const chat = findChatGlobalBinding(bindings)
  if (chat) {
    return {
      bindings,
      activePresetId: chat.apiConfigId,
    }
  }
  const syncedBindings = upsertChatGlobalBinding(bindings, activePresetId, now)
  return {
    bindings: syncedBindings,
    activePresetId: activePresetId.trim(),
  }
}

export function featureBindingReferencePath(binding: FeatureBinding): string {
  return binding.featureType
}
