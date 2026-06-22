import type { ChatTurnItem } from '@/types/chat-turn'
import type { InjectionKey, Ref } from 'vue'

export interface ConversationBranchContext {
  activeBranchPath: Ref<string>
  forkTurnIdsWithSiblings: Ref<Set<string>>
  branchPanelOpen: Ref<boolean>
  branchBusy: Ref<boolean>
  openBranchPanel: (forkTurnId?: string) => void
  requestCreateBranchFromTurn: (turn: ChatTurnItem) => void
  isForkTurn: (turn: ChatTurnItem) => boolean
}

export const CONVERSATION_BRANCH_KEY: InjectionKey<ConversationBranchContext> = Symbol(
  'conversationBranch',
)
