export type {
  GroupChatDecaySettings,
  GroupChatDiceSkipReason,
  GroupChatMemberSettings,
  GroupChatSettings,
  GroupChatTurnState,
  SpeakerMode,
} from '../shared/group-chat-settings.js'

export {
  cloneGroupChatTurnState,
  DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
  DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION,
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

export { groupChatAssembleInstruction } from './instructions.js'

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
  findReceiveInTurn,
  getSegmentAtIndex,
  getTurnGroupChatState,
  getTurnSegments,
  lastSegmentSpeakerId,
  rebuildGroupChatTurnStateFromTurn,
  segmentCountForTurn,
  segmentSkipQuotaDeductionOnRecord,
  syncTurnSpeakerFromActiveSegment,
  turnHasAssistantContent,
} from './segments.js'

export {
  applyNextSpeakerStateToTurn,
  resolveFirstSegmentSpeaker,
  resolveNextSpeakerForTurn,
  validateExplicitFirstSegmentSpeaker,
} from './resolve.js'

export {
  parseGroupContinueBody,
  validateGroupContinueRequest,
} from './continue.js'

export {
  buildGroupChatNotChar,
  buildGroupMacroStrings,
  extractNextSpeakerHint,
  resolveDisplayNameToCharacterId,
  resolveOutboundSpeakerCharacterId,
  resolveSpeakerQueueIds,
  spokenCharacterIdsFromTurn,
} from './outbound.js'
