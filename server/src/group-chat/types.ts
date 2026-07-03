import type { TurnReceive } from '../chat-storage.js'
import type {
  GroupChatDiceSkipReason,
  GroupChatSettings,
  GroupChatTurnState,
  SpeakerMode,
} from '../shared/group-chat-settings.js'

export interface AssistantSegmentRecord {
  id: string
  speakerCharacterId: string
  receives: TurnReceive[]
  activeReceiveIndex: number
  meta?: {
    nextSpeakerHint?: string
    /** 本段落盘时下一段选人 audit（供下一段 segmentPick 展示掷骰表） */
    resolvedNextSpeakerAudit?: GroupChatSpeakerAudit
    /** 本段 segmentPick audit（regen 时复用） */
    segmentPickAudit?: GroupChatSpeakerAudit
  }
}

export type GroupChatSpeakerPickMethod =
  | 'queue'
  | 'sequential'
  | 'dice'
  | 'nextAtHint'
  | 'explicit'
  | 'manual'
  | 'maxSegments'
  | 'disabled'
  | 'none'

export interface GroupChatDiceBidAuditRow {
  characterId: string
  eligible: boolean
  skipReason?: GroupChatDiceSkipReason
  quotaRemaining: number
  speakCount: number
  /** per-bot 衰减概率 P；跳过者仍记录便于审计 */
  probability: number
  weight: number
  roll?: number
  passed?: boolean
  score?: number
}

export type GroupChatDiceAuditOutcome =
  | 'winner'
  | 'allFailedStop'
  | 'allFailedFirstSegmentFallback'
  | 'noEligible'

export interface GroupChatDiceAudit {
  segmentCount: number
  bids: GroupChatDiceBidAuditRow[]
  winnerCharacterId: string | null
  outcome: GroupChatDiceAuditOutcome
}

export interface GroupChatSpeakerAudit {
  speakerMode?: SpeakerMode
  phase: 'firstSegment' | 'nextAfterSegment'
  method: GroupChatSpeakerPickMethod
  segmentIndex: number
  maxSegmentsPerTurn?: number
  speakerCharacterId?: string | null
  nextSpeakerHint?: string
  decayStopped?: boolean
  needsManualContinue?: boolean
  firstSegmentAllFailFallback?: boolean
  dice?: GroupChatDiceAudit
}

export interface GroupChatAuditSnapshot {
  segmentSpeakerCharacterId?: string
  segmentPick?: GroupChatSpeakerAudit
  nextSpeaker?: GroupChatSpeakerAudit
}

export interface ResolveNextSpeakerResult {
  speakerCharacterId: string | null
  decayStopped?: boolean
  needsManualContinue?: boolean
  turnState?: GroupChatTurnState
  firstSegmentAllFailFallback?: boolean
  groupChatAudit?: GroupChatSpeakerAudit
}

export interface GroupChatResolveParams {
  groupChat: GroupChatSettings
  characterIds: string[]
  characterNames: string[]
  defaultSpeakerCharacterId: string
  conversationId: string
}

export interface GroupContinueBody {
  turnOrdinal: number
  speakerCharacterId: string
  afterSegmentIndex: number
}

export type GroupContinueValidation =
  | 'ok'
  | 'invalid_body'
  | 'invalid_after_segment'
  | 'speaker_not_bound'
  | 'consecutive_speaker'
  | 'no_quota'
  | 'duplicate_speaker'

export const GROUP_CHAT_NEXT_AT_INSTRUCTION =
  '若需其他角色接下一句，使用 [NEXT@角色名]，例如 [NEXT@Betty]。\n每个角色每轮发言次数有限；助手消息中的裸 @ 不会生效。'
