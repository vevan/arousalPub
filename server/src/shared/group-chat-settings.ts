/** Web / Server 共用的群聊设置归一化与选人资格判定（经 sync-group-chat-settings-shared 同步）。 */

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

export interface GroupChatTurnState {
  quotaRemaining: Record<string, number>
  speakCount: Record<string, number>
}

export interface GroupChatSettings {
  enabled?: boolean
  speakerMode?: SpeakerMode
  /** @deprecated 使用 speakerMode */
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

export type GroupChatDiceSkipReason = 'consecutive' | 'quota' | 'muted'

function clampUnitRate(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

function normalizePositiveInt(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.max(1, Math.round(n))
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

export function groupChatMemberWeight(
  characterId: string,
  settings: GroupChatSettings,
): number {
  const w = settings.members?.[characterId.trim()]?.weight
  if (typeof w === 'number' && Number.isFinite(w) && w >= 0) return w
  return 1
}

export function cloneGroupChatTurnState(
  state: GroupChatTurnState,
): GroupChatTurnState {
  return {
    quotaRemaining: { ...state.quotaRemaining },
    speakCount: { ...state.speakCount },
  }
}

export function initGroupChatTurnState(
  settings: GroupChatSettings,
  characterIds: string[],
): GroupChatTurnState {
  const groupChat = normalizeGroupChatSettings(settings)
  const quotaRemaining: Record<string, number> = {}
  const speakCount: Record<string, number> = {}
  for (const rawId of characterIds) {
    const id = rawId.trim()
    if (!id) continue
    quotaRemaining[id] = groupChatMemberSpeakQuota(id, groupChat)
    speakCount[id] = 0
  }
  return { quotaRemaining, speakCount }
}

export function recordSegmentSpeaker(
  state: GroupChatTurnState,
  speakerId: string,
  opts?: { skipQuotaDeduction?: boolean },
): GroupChatTurnState {
  const id = speakerId.trim()
  const next = cloneGroupChatTurnState(state)
  next.speakCount[id] = (next.speakCount[id] ?? 0) + 1
  if (!opts?.skipQuotaDeduction) {
    const q = next.quotaRemaining[id] ?? 0
    next.quotaRemaining[id] = Math.max(0, q - 1)
  }
  return next
}

export function resolveDiceSkipReason(
  characterId: string,
  params: {
    settings: GroupChatSettings
    turnState: GroupChatTurnState
    lastSpeakerCharacterId?: string | null
    allowConsecutive?: boolean
  },
): GroupChatDiceSkipReason | null {
  const id = characterId.trim()
  if (!id) return 'quota'
  const settings = normalizeGroupChatSettings(params.settings)
  if (isGroupChatMemberMuted(id, settings)) return 'muted'
  const quota = params.turnState.quotaRemaining[id]
  if (quota === undefined || quota <= 0) return 'quota'
  const last = params.lastSpeakerCharacterId?.trim() || null
  if (!params.allowConsecutive && last && id === last) return 'consecutive'
  return null
}

export function listEligibleCharacterIds(params: {
  characterIds: string[]
  settings: GroupChatSettings
  turnState: GroupChatTurnState
  lastSpeakerCharacterId?: string | null
  allowConsecutive?: boolean
}): string[] {
  const settings = normalizeGroupChatSettings(params.settings)
  const last = params.lastSpeakerCharacterId?.trim() || null
  return params.characterIds.filter((rawId) => {
    const id = rawId.trim()
    if (!id) return false
    return (
      resolveDiceSkipReason(id, {
        settings,
        turnState: params.turnState,
        lastSpeakerCharacterId: last,
        allowConsecutive: params.allowConsecutive,
      }) === null
    )
  })
}

export interface GroupChatSegmentSkipQuotaSource {
  skipSpeakQuotaDeduction?: boolean
  segmentPickAudit?: {
    firstSegmentAllFailFallback?: boolean
    dice?: { outcome?: string }
  }
}

/** 前后端统一：本 segment 是否跳过 speakQuota 扣减 */
export function segmentSkipQuotaDeduction(
  meta?: GroupChatSegmentSkipQuotaSource | null,
): boolean {
  if (!meta) return false
  if (meta.skipSpeakQuotaDeduction === true) return true
  const audit = meta.segmentPickAudit
  if (!audit) return false
  if (audit.firstSegmentAllFailFallback === true) return true
  return audit.dice?.outcome === 'allFailedFirstSegmentFallback'
}

export function mergeGroupChatSettings(
  prev: GroupChatSettings | undefined,
  patch: unknown,
): GroupChatSettings {
  const base = normalizeGroupChatSettings(prev)
  if (patch === null) return defaultGroupChatSettings()
  if (!patch || typeof patch !== 'object') return base
  const o = patch as Record<string, unknown>
  const next: GroupChatSettings = { ...base }
  if (typeof o.enabled === 'boolean') next.enabled = o.enabled
  if (typeof o.speakerMode === 'string') {
    const m = o.speakerMode.trim().toLowerCase()
    if (m === 'sequential' || m === 'dice' || m === 'next@') next.speakerMode = m
  }
  if (typeof o.mode === 'string') {
    const m = o.mode.trim().toLowerCase()
    if (m === 'weighted' || m === 'sequential') next.mode = m
  }
  if (Object.prototype.hasOwnProperty.call(o, 'maxSegmentsPerTurn')) {
    next.maxSegmentsPerTurn = normalizePositiveInt(
      o.maxSegmentsPerTurn,
      base.maxSegmentsPerTurn ?? DEFAULT_MAX_SEGMENTS_PER_TURN,
    )
  }
  if (Object.prototype.hasOwnProperty.call(o, 'defaultSpeakQuota')) {
    next.defaultSpeakQuota = normalizePositiveInt(
      o.defaultSpeakQuota,
      base.defaultSpeakQuota ?? DEFAULT_SPEAK_QUOTA,
    )
  }
  if (typeof o.autoContinue === 'boolean') next.autoContinue = o.autoContinue
  if (typeof o.confirmContinue === 'boolean') {
    next.confirmContinue = o.confirmContinue
  }
  if (Object.prototype.hasOwnProperty.call(o, 'decay')) {
    next.decay = normalizeGroupChatDecaySettings({
      ...base.decay,
      ...(o.decay && typeof o.decay === 'object' && !Array.isArray(o.decay)
        ? o.decay
        : {}),
    })
  }
  if (Object.prototype.hasOwnProperty.call(o, 'members')) {
    const patchMembers = normalizeGroupChatMembers(o.members)
    const mergedMembers: Record<string, GroupChatMemberSettings> = {
      ...(base.members ?? {}),
    }
    for (const [id, patchMember] of Object.entries(patchMembers)) {
      mergedMembers[id] = { ...mergedMembers[id], ...patchMember }
    }
    next.members = mergedMembers
  }
  return normalizeGroupChatSettings(next)
}
