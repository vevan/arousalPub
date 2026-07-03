export type {
  GroupChatDecaySettings,
  GroupChatDiceSkipReason,
  GroupChatMemberSettings,
  GroupChatMode,
  GroupChatSettings,
  GroupChatTurnState,
  SpeakerMode,
} from '../shared/group-chat-settings.js'

export {
  cloneGroupChatTurnState,
  DEFAULT_MAX_SEGMENTS_PER_TURN,
  DEFAULT_SPEAK_QUOTA,
  defaultGroupChatDecaySettings,
  defaultGroupChatSettings,
  groupChatMemberSpeakQuota,
  groupChatMemberWeight,
  initGroupChatTurnState,
  isGroupChatMemberMuted,
  listEligibleCharacterIds,
  mergeGroupChatSettings,
  normalizeGroupChatDecaySettings,
  normalizeGroupChatMembers,
  normalizeGroupChatSettings,
  recordSegmentSpeaker,
  resolveDiceSkipReason,
  segmentSkipQuotaDeduction,
} from '../shared/group-chat-settings.js'

export type {
  AssistantSegmentRecord,
  GroupChatAuditSnapshot,
  GroupContinueBody,
  GroupContinueValidation,
  GroupChatDiceAudit,
  GroupChatDiceAuditOutcome,
  GroupChatDiceBidAuditRow,
  GroupChatResolveParams,
  GroupChatSpeakerAudit,
  GroupChatSpeakerPickMethod,
  ResolveNextSpeakerResult,
} from './types.js'

export { GROUP_CHAT_NEXT_AT_INSTRUCTION } from './types.js'

export type { DiceBiddingResult } from './pick.js'

export {
  computeBotContinueProbability,
  diceBiddingPick,
  pickFirstSpeakerForSend,
  pickFromSpeakerQueue,
  pickSequentialSpeaker,
  validateNextAtHint,
} from './pick.js'

export {
  attachResolvedNextSpeakerAuditToActiveSegment,
  attachSegmentPickAuditToSegment,
  buildGroupChatAuditSnapshot,
  buildGroupChatSpeakerAudit,
  segmentPickAuditFromCarriedNextSpeaker,
} from './audit.js'

export {
  getActiveSegment,
  getActiveSegmentIndex,
  getTurnGroupChatState,
  getTurnSegments,
  lastSegmentSpeakerId,
  rebuildGroupChatTurnStateFromTurn,
  segmentCountForTurn,
  segmentSkipQuotaDeductionOnRecord,
  syncTurnReceivesFromActiveSegment,
} from './segments.js'

export {
  applyNextSpeakerStateToTurn,
  groupChatNextAtInstruction,
  resolveFirstSegmentSpeaker,
  resolveNextSpeakerForTurn,
  validateExplicitFirstSegmentSpeaker,
} from './resolve.js'

export {
  parseGroupContinueBody,
  validateGroupContinueRequest,
} from './continue.js'

export {
  buildGroupMacroStrings,
  extractNextSpeakerHint,
  resolveDisplayNameToCharacterId,
  resolveOutboundSpeakerCharacterId,
  resolveSpeakerQueueIds,
  spokenCharacterIdsFromTurn,
} from './outbound.js'
