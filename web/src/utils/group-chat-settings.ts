export interface GroupChatDecaySettings {
  enabled?: boolean
  initialRate?: number
  step?: number
  floor?: number
}

export interface GroupChatMemberSettings {
  weight?: number
  muted?: boolean
  speakQuota?: number
}

/** @deprecated G2；normalize 时 `weighted` → `speakerMode: dice` */
export type GroupChatMode = 'weighted' | 'sequential'

export type SpeakerMode = 'sequential' | 'dice' | 'next@'

export interface GroupChatSettings {
  enabled?: boolean
  speakerMode?: SpeakerMode
  mode?: GroupChatMode
  autoContinue?: boolean
  confirmContinue?: boolean
  maxSegmentsPerTurn?: number
  defaultSpeakQuota?: number
  decay?: GroupChatDecaySettings
  members?: Record<string, GroupChatMemberSettings>
}

export const DEFAULT_SPEAK_QUOTA = 2
export const DEFAULT_MAX_SEGMENTS_PER_TURN = 8

function clampUnitRate(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

function normalizePositiveInt(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.max(1, Math.round(n))
}

export function defaultGroupChatDecaySettings(): GroupChatDecaySettings {
  return { enabled: true, initialRate: 1, step: 0.2, floor: 0 }
}

export function defaultGroupChatSettings(): GroupChatSettings {
  return {
    enabled: false,
    speakerMode: 'dice',
    mode: 'weighted',
    autoContinue: false,
    confirmContinue: true,
    maxSegmentsPerTurn: DEFAULT_MAX_SEGMENTS_PER_TURN,
    defaultSpeakQuota: DEFAULT_SPEAK_QUOTA,
    decay: defaultGroupChatDecaySettings(),
    members: {},
  }
}

function resolveSpeakerModeFromRaw(
  o: Record<string, unknown>,
  base: GroupChatSettings,
): SpeakerMode {
  if (typeof o.speakerMode === 'string') {
    const m = o.speakerMode.trim().toLowerCase()
    if (m === 'sequential' || m === 'dice' || m === 'next@') return m
  }
  const legacy = typeof o.mode === 'string' ? o.mode.trim().toLowerCase() : ''
  if (legacy === 'sequential') return 'sequential'
  return base.speakerMode ?? 'dice'
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
    if (typeof m.speakQuota === 'number' && Number.isFinite(m.speakQuota) && m.speakQuota >= 0) {
      entry.speakQuota = Math.round(m.speakQuota)
    }
    out[id] = entry
  }
  return out
}

export function normalizeGroupChatSettings(raw: unknown): GroupChatSettings {
  const base = defaultGroupChatSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const speakerMode = resolveSpeakerModeFromRaw(o, base)
  const modeRaw = typeof o.mode === 'string' ? o.mode.trim().toLowerCase() : ''
  const mode: GroupChatMode =
    modeRaw === 'sequential' ? 'sequential' : 'weighted'
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    speakerMode,
    mode,
    autoContinue:
      typeof o.autoContinue === 'boolean' ? o.autoContinue : base.autoContinue,
    confirmContinue:
      typeof o.confirmContinue === 'boolean'
        ? o.confirmContinue
        : base.confirmContinue,
    maxSegmentsPerTurn: normalizePositiveInt(
      o.maxSegmentsPerTurn,
      base.maxSegmentsPerTurn ?? DEFAULT_MAX_SEGMENTS_PER_TURN,
    ),
    defaultSpeakQuota: normalizePositiveInt(
      o.defaultSpeakQuota,
      base.defaultSpeakQuota ?? DEFAULT_SPEAK_QUOTA,
    ),
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

export function isGroupChatMemberMuted(
  characterId: string,
  settings: GroupChatSettings,
): boolean {
  return memberSettingsFor(settings, characterId).muted === true
}

export function groupChatMemberSpeakQuota(
  characterId: string,
  settings: GroupChatSettings,
): number {
  const q = memberSettingsFor(settings, characterId).speakQuota
  if (typeof q === 'number' && Number.isFinite(q) && q >= 0) return Math.round(q)
  const normalized = normalizeGroupChatSettings(settings)
  return normalized.defaultSpeakQuota ?? DEFAULT_SPEAK_QUOTA
}
