export interface GroupChatDecaySettings {
  enabled?: boolean
  initialRate?: number
  step?: number
  floor?: number
}

export interface GroupChatMemberSettings {
  weight?: number
  muted?: boolean
}

export type GroupChatMode = 'weighted' | 'sequential'

export interface GroupChatSettings {
  enabled?: boolean
  mode?: GroupChatMode
  autoContinue?: boolean
  confirmContinue?: boolean
  decay?: GroupChatDecaySettings
  members?: Record<string, GroupChatMemberSettings>
}

function clampUnitRate(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

export function defaultGroupChatDecaySettings(): GroupChatDecaySettings {
  return { enabled: true, initialRate: 1, step: 0.2, floor: 0 }
}

export function defaultGroupChatSettings(): GroupChatSettings {
  return {
    enabled: false,
    mode: 'weighted',
    autoContinue: false,
    confirmContinue: true,
    decay: defaultGroupChatDecaySettings(),
    members: {},
  }
}

export function normalizeGroupChatDecaySettings(
  raw: unknown,
): GroupChatDecaySettings {
  const base = defaultGroupChatDecaySettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    initialRate: clampUnitRate(o.initialRate, base.initialRate!),
    step: clampUnitRate(o.step, base.step!),
    floor: clampUnitRate(o.floor, base.floor!),
  }
}

export function normalizeGroupChatMembers(
  raw: unknown,
): Record<string, GroupChatMemberSettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, GroupChatMemberSettings> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const id = key.trim()
    if (!id || !val || typeof val !== 'object' || Array.isArray(val)) continue
    const m = val as Record<string, unknown>
    const entry: GroupChatMemberSettings = {}
    if (typeof m.muted === 'boolean') entry.muted = m.muted
    if (typeof m.weight === 'number' && Number.isFinite(m.weight) && m.weight >= 0) {
      entry.weight = m.weight
    }
    out[id] = entry
  }
  return out
}

export function normalizeGroupChatSettings(raw: unknown): GroupChatSettings {
  const base = defaultGroupChatSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const modeRaw = typeof o.mode === 'string' ? o.mode.trim().toLowerCase() : ''
  const mode: GroupChatMode =
    modeRaw === 'sequential' ? 'sequential' : 'weighted'
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    mode,
    autoContinue:
      typeof o.autoContinue === 'boolean' ? o.autoContinue : base.autoContinue,
    confirmContinue:
      typeof o.confirmContinue === 'boolean'
        ? o.confirmContinue
        : base.confirmContinue,
    decay: normalizeGroupChatDecaySettings(o.decay ?? base.decay),
    members: normalizeGroupChatMembers(o.members),
  }
}

export function memberSettingsFor(
  settings: GroupChatSettings,
  characterId: string,
): GroupChatMemberSettings {
  return settings.members?.[characterId.trim()] ?? {}
}
