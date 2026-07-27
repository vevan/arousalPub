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
  /** 当前分支路径上的分叉锚点（读路径 overlay）；其上禁止 swipe */
  isForkAnchorOnActivePath: (turn: ChatTurnItem) => boolean
}

export const CONVERSATION_BRANCH_KEY: InjectionKey<ConversationBranchContext> = Symbol(
  'conversationBranch',
)
