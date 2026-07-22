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
  /** 会话内 bot 区分色 `#rrggbb`；缺省由 ensureMemberColors 分配 */
  color?: string
}

export type SpeakerMode = 'sequential' | 'dice' | 'next@'

/** 群聊角色扮演说明（注入 user 消息后；可在会话群聊设置中覆盖） */
export const DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION =
  'This is a group-chat role-playing game. You are currently playing the role of {{char}}. *Must* respond strictly according to {{char}}\'s persona and *Solely* as {{char}}; Breaking character or responding as another character is prohibited. Do not overthink; simply execute this instruction strictly and with the highest priority.'

/** [NEXT@] 接续说明（仅 next@ 模式与群聊说明拼接注入） */
export const DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION =
  'After completing your response, determine the next character to speak based on the flow of the conversation and indicate this at the end of your message using the format [NEXT@CharacterName] (e.g., [NEXT@Betty]); {{user}} must be excluded from this selection.'

export interface GroupChatTurnState {
  quotaRemaining: Record<string, number>
  speakCount: Record<string, number>
}

export interface GroupChatSettings {
  enabled?: boolean
  speakerMode?: SpeakerMode
  autoContinue?: boolean
  confirmContinue?: boolean
  maxSegmentsPerTurn?: number
  defaultSpeakQuota?: number
  decay?: GroupChatDecaySettings
  members?: Record<string, GroupChatMemberSettings>
  /** 群聊角色说明；空串时用 DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION */
  groupAssembleInstruction?: string
  /** [NEXT@] 接续说明；空串时用 DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION */
  continueAssembleInstruction?: string
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
  return base.speakerMode ?? 'dice'
}

export function defaultGroupChatDecaySettings(): GroupChatDecaySettings {
  return { enabled: true, initialRate: 1, step: 0.2, floor: 0 }
}

export function defaultGroupChatSettings(): GroupChatSettings {
  return {
    enabled: false,
    speakerMode: 'dice',
    autoContinue: false,
    confirmContinue: true,
    maxSegmentsPerTurn: DEFAULT_MAX_SEGMENTS_PER_TURN,
    defaultSpeakQuota: DEFAULT_SPEAK_QUOTA,
    decay: defaultGroupChatDecaySettings(),
    members: {},
    groupAssembleInstruction: DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
    continueAssembleInstruction: DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION,
  }
}

/**
 * 新建多人对话（≥2 bot）的初始群聊设置：
 * 开启群聊、掷骰竞标、每段后确认、额度 2、衰减开、段数上限 = bot 数 + 2，并预分配成员色。
 */
export function initialMultiBotGroupChatSettings(
  characterIds: readonly string[],
): GroupChatSettings {
  const ids = characterIds.map((id) => id.trim()).filter(Boolean)
  const base = defaultGroupChatSettings()
  return groupChatWithEnsuredMemberColors(
    {
      ...base,
      enabled: true,
      speakerMode: 'dice',
      autoContinue: false,
      confirmContinue: true,
      maxSegmentsPerTurn: Math.max(1, ids.length + 2),
      defaultSpeakQuota: DEFAULT_SPEAK_QUOTA,
      decay: defaultGroupChatDecaySettings(),
      members: {},
    },
    ids,
  )
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
    const color = parseMemberColor(m.color)
    if (color) entry.color = color
    out[id] = entry
  }
  return out
}

const MEMBER_COLOR_RE = /^#([0-9a-f]{6})$/i

/** 合法则返回规范化小写 `#rrggbb`，否则 null */
export function parseMemberColor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  const m = MEMBER_COLOR_RE.exec(s)
  if (!m) return null
  return `#${m[1]!.toLowerCase()}`
}

export function isValidMemberColor(raw: unknown): boolean {
  return parseMemberColor(raw) != null
}

/** 固定高区分度调色板（HSL 色相均匀） */
export const MEMBER_COLOR_PALETTE: readonly string[] = [
  '#e11d48', // rose
  '#2563eb', // blue
  '#16a34a', // green
  '#ca8a04', // yellow
  '#9333ea', // purple
  '#ea580c', // orange
  '#0891b2', // cyan
  '#db2777', // pink
  '#4f46e5', // indigo
  '#65a30d', // lime
  '#0d9488', // teal
  '#dc2626', // red
]

function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.min(1, Math.max(0, s))
  const lit = Math.min(1, Math.max(0, l))
  const c = (1 - Math.abs(2 * lit - 1)) * sat
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) {
    r = c
    g = x
  } else if (hp < 2) {
    r = x
    g = c
  } else if (hp < 3) {
    g = c
    b = x
  } else if (hp < 4) {
    g = x
    b = c
  } else if (hp < 5) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const m = lit - c / 2
  const toByte = (v: number) =>
    Math.round(Math.min(255, Math.max(0, (v + m) * 255)))
      .toString(16)
      .padStart(2, '0')
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`
}

/**
 * 为尚缺颜色的槽位分配互不撞车的 `#rrggbb`。
 * 优先用固定调色板中未占用色；不够时用 golden-angle 扩展。
 */
export function allocateDistinctMemberColors(
  existingColors: readonly string[],
  count: number,
): string[] {
  if (count <= 0) return []
  const used = new Set(
    existingColors
      .map((c) => parseMemberColor(c))
      .filter((c): c is string => c != null),
  )
  const out: string[] = []
  for (const swatch of MEMBER_COLOR_PALETTE) {
    if (out.length >= count) break
    if (used.has(swatch)) continue
    used.add(swatch)
    out.push(swatch)
  }
  let i = 0
  while (out.length < count) {
    const hue = (i * 137.508) % 360
    const candidate = hslToHex(hue, 0.62, 0.48)
    i += 1
    if (used.has(candidate)) continue
    used.add(candidate)
    out.push(candidate)
  }
  return out
}

/**
 * 为 characterIds 中尚无合法 color 的成员补色；保留已有字段。
 * 返回可能更新后的 members（浅拷贝）；无变更时仍返回新对象（调用方可 JSON 比较）。
 */
export function ensureMemberColors(
  characterIds: readonly string[],
  members: Record<string, GroupChatMemberSettings> | undefined,
): Record<string, GroupChatMemberSettings> {
  const next: Record<string, GroupChatMemberSettings> = {
    ...(members ?? {}),
  }
  const ids = characterIds.map((id) => id.trim()).filter(Boolean)
  const missing: string[] = []
  const existing: string[] = []
  for (const id of ids) {
    const cur = parseMemberColor(next[id]?.color)
    if (cur) {
      next[id] = { ...next[id], color: cur }
      existing.push(cur)
    } else {
      missing.push(id)
    }
  }
  const allocated = allocateDistinctMemberColors(existing, missing.length)
  for (let i = 0; i < missing.length; i++) {
    const id = missing[i]!
    next[id] = { ...next[id], color: allocated[i]! }
  }
  return next
}

/** characterIds 中是否仍有缺合法 color 的 bot */
export function memberColorsIncomplete(
  characterIds: readonly string[],
  members: Record<string, GroupChatMemberSettings> | undefined,
): boolean {
  for (const raw of characterIds) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (!id) continue
    if (!parseMemberColor(members?.[id]?.color)) return true
  }
  return false
}

/** 群聊已开启时为缺色成员补色；未开启原样返回 */
export function groupChatWithEnsuredMemberColors(
  settings: GroupChatSettings,
  characterIds: readonly string[],
): GroupChatSettings {
  if (!settings.enabled) return settings
  return {
    ...settings,
    members: ensureMemberColors(characterIds, settings.members),
  }
}

export function groupChatMemberColor(
  characterId: string,
  settings: GroupChatSettings,
): string | null {
  return parseMemberColor(memberSettingsFor(settings, characterId).color)
}

export function normalizeGroupChatSettings(raw: unknown): GroupChatSettings {
  const base = defaultGroupChatSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const speakerMode = resolveSpeakerModeFromRaw(o, base)
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    speakerMode,
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
    groupAssembleInstruction:
      typeof o.groupAssembleInstruction === 'string'
        ? o.groupAssembleInstruction
        : base.groupAssembleInstruction,
    continueAssembleInstruction:
      typeof o.continueAssembleInstruction === 'string'
        ? o.continueAssembleInstruction
        : base.continueAssembleInstruction,
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
  if (typeof o.groupAssembleInstruction === 'string') {
    next.groupAssembleInstruction = o.groupAssembleInstruction
  }
  if (typeof o.continueAssembleInstruction === 'string') {
    next.continueAssembleInstruction = o.continueAssembleInstruction
  }
  return normalizeGroupChatSettings(next)
}
