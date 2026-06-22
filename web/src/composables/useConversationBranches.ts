import {
  branchPathLabel,
  collectForkTurnIdsWithSiblings,
  createConversationBranch,
  deleteConversationBranch,
  fetchConversationBranchTree,
  findBranchTreeNode,
  patchConversationActiveBranchPath,
  patchConversationBranchLabel,
  repairConversationChunkIndex,
  type BranchTreeNodeDto,
} from '@/utils/conversation-branches-api'
import { ApiRequestError } from '@/utils/api-error-message'
import type { ChatTurnItem } from '@/types/chat-turn'
import { computed, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message
  return e instanceof Error ? e.message : String(e)
}

function errorCode(e: unknown): string | null {
  if (e instanceof ApiRequestError) return e.code
  return null
}

export function useConversationBranches(params: {
  getConversationId: () => string
  onActivePathChanged: () => Promise<void>
}) {
  const { t } = useI18n()

  const activeBranchPath = ref('')
  const branchPanelOpen = ref(false)
  const branchBusy = ref(false)
  const branchTreeLoading = ref(false)
  const branchTreeNodes = shallowRef<BranchTreeNodeDto[]>([])
  const branchLoadError = ref('')
  const branchSuccessMessage = ref('')
  const branchActionError = ref('')
  const branchHighlightForkTurnId = ref<string | null>(null)
  const branchRegistryBroken = ref(false)

  const createBranchDialogOpen = ref(false)
  const pendingCreateTurn = ref<ChatTurnItem | null>(null)

  const forkTurnIdsWithSiblings = computed(
    () => collectForkTurnIdsWithSiblings(branchTreeNodes.value),
  )

  const activeBranchNode = computed(() =>
    findBranchTreeNode(branchTreeNodes.value, activeBranchPath.value),
  )

  const activeBranchDisplayLabel = computed(() =>
    branchPathLabel(activeBranchPath.value, activeBranchNode.value, t),
  )

  function syncActiveFromIndex(idx: Record<string, unknown>) {
    const raw = idx.activeBranchPath
    activeBranchPath.value =
      typeof raw === 'string' && raw.trim() ? raw.trim() : ''
  }

  function notifyActionError(msg: string) {
    branchLoadError.value = msg
    if (!branchPanelOpen.value && !createBranchDialogOpen.value) {
      branchActionError.value = msg
    }
  }

  function noteBranchError(e: unknown) {
    branchLoadError.value = errorMessage(e)
    branchRegistryBroken.value = errorCode(e) === 'branch_registry_broken'
  }

  async function refreshBranchTree() {
    const id = params.getConversationId()
    if (!id) return
    branchLoadError.value = ''
    branchRegistryBroken.value = false
    branchTreeLoading.value = true
    try {
      const tree = await fetchConversationBranchTree(id)
      activeBranchPath.value = tree.activeBranchPath ?? ''
      branchTreeNodes.value = tree.nodes
    } catch (e) {
      noteBranchError(e)
    } finally {
      branchTreeLoading.value = false
    }
  }

  async function repairBranchRegistry() {
    const id = params.getConversationId()
    if (!id || branchBusy.value) return false
    branchBusy.value = true
    branchLoadError.value = ''
    try {
      await repairConversationChunkIndex(id)
      branchRegistryBroken.value = false
      await refreshBranchTree()
      await params.onActivePathChanged()
      branchSuccessMessage.value = t('chat.branches.registryRepaired')
      return true
    } catch (e) {
      noteBranchError(e)
      return false
    } finally {
      branchBusy.value = false
    }
  }

  async function switchActiveBranch(path: string) {
    const id = params.getConversationId()
    if (!id || branchBusy.value) return
    const next = path.trim()
    if (next === activeBranchPath.value) {
      branchPanelOpen.value = false
      return
    }
    branchBusy.value = true
    branchLoadError.value = ''
    branchRegistryBroken.value = false
    try {
      await patchConversationActiveBranchPath(id, next || null)
      await refreshBranchTree()
      await params.onActivePathChanged()
      branchPanelOpen.value = false
      branchSuccessMessage.value = t('chat.branches.branchSwitched')
    } catch (e) {
      noteBranchError(e)
      notifyActionError(errorMessage(e))
    } finally {
      branchBusy.value = false
    }
  }

  function requestCreateBranchFromTurn(turn: ChatTurnItem) {
    if (branchBusy.value) return
    const forkTurnId = turn.turnId?.trim()
    if (!forkTurnId) return
    pendingCreateTurn.value = turn
    branchLoadError.value = ''
    createBranchDialogOpen.value = true
  }

  async function confirmCreateBranch(label: string, setActive = true) {
    const id = params.getConversationId()
    const turn = pendingCreateTurn.value
    if (!id || !turn || branchBusy.value) return
    const forkTurnId = turn.turnId?.trim()
    if (!forkTurnId) return

    branchBusy.value = true
    branchLoadError.value = ''
    try {
      const receive = turn.receives[turn.activeReceiveIndex]
      const trimmed = label.trim()
      const result = await createConversationBranch(id, {
        forkTurnId,
        ...(receive?.id ? { forkMessageId: receive.id } : {}),
        ...(trimmed ? { label: trimmed } : {}),
        ...(setActive ? {} : { setActive: false }),
      })
      createBranchDialogOpen.value = false
      pendingCreateTurn.value = null
      await refreshBranchTree()
      if (setActive) {
        await params.onActivePathChanged()
        branchSuccessMessage.value = t('chat.branches.branchCreated')
      } else {
        branchSuccessMessage.value = t('chat.branches.branchCreatedStay')
      }
      if (setActive && result.activeBranchPath) {
        activeBranchPath.value = result.activeBranchPath
      }
    } catch (e) {
      noteBranchError(e)
    } finally {
      branchBusy.value = false
    }
  }

  function cancelCreateBranch() {
    createBranchDialogOpen.value = false
    pendingCreateTurn.value = null
    branchLoadError.value = ''
  }

  async function renameBranch(path: string, label: string) {
    const id = params.getConversationId()
    const target = path.trim()
    if (!id || !target || branchBusy.value) return false
    branchBusy.value = true
    branchLoadError.value = ''
    try {
      const trimmed = label.trim()
      await patchConversationBranchLabel(id, target, trimmed || null)
      await refreshBranchTree()
      branchSuccessMessage.value = t('chat.branches.branchRenamed')
      return true
    } catch (e) {
      noteBranchError(e)
      return false
    } finally {
      branchBusy.value = false
    }
  }

  async function deleteBranch(path: string) {
    const id = params.getConversationId()
    const target = path.trim()
    if (!id || !target || branchBusy.value) return
    branchBusy.value = true
    branchLoadError.value = ''
    try {
      const result = await deleteConversationBranch(id, target)
      activeBranchPath.value = result.activeBranchPath ?? ''
      await refreshBranchTree()
      await params.onActivePathChanged()
      const warnings: string[] = []
      if (result.memoryCleanupFailed) {
        warnings.push(t('chat.branches.memoryCleanupFailed'))
      }
      if (result.activeResetFailed) {
        warnings.push(t('chat.branches.activeResetFailed'))
      }
      branchSuccessMessage.value =
        warnings.length > 0
          ? `${t('chat.branches.branchDeleted')} — ${warnings.join(' ')}`
          : t('chat.branches.branchDeleted')
    } catch (e) {
      noteBranchError(e)
      notifyActionError(errorMessage(e))
    } finally {
      branchBusy.value = false
    }
  }

  function openBranchPanel(forkTurnId?: string) {
    branchHighlightForkTurnId.value = forkTurnId?.trim() || null
    branchPanelOpen.value = true
    void refreshBranchTree()
  }

  function clearBranchHighlight() {
    branchHighlightForkTurnId.value = null
  }

  function isForkTurn(turn: ChatTurnItem): boolean {
    const tid = turn.turnId?.trim()
    return !!tid && forkTurnIdsWithSiblings.value.has(tid)
  }

  return {
    activeBranchPath,
    branchPanelOpen,
    branchBusy,
    branchTreeLoading,
    branchTreeNodes,
    branchLoadError,
    branchSuccessMessage,
    branchActionError,
    branchHighlightForkTurnId,
    branchRegistryBroken,
    createBranchDialogOpen,
    pendingCreateTurn,
    forkTurnIdsWithSiblings,
    activeBranchDisplayLabel,
    syncActiveFromIndex,
    refreshBranchTree,
    repairBranchRegistry,
    switchActiveBranch,
    requestCreateBranchFromTurn,
    confirmCreateBranch,
    cancelCreateBranch,
    renameBranch,
    deleteBranch,
    openBranchPanel,
    clearBranchHighlight,
    isForkTurn,
  }
}
