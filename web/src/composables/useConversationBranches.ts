import {
  branchPathLabel,
  collectForkTurnIdsWithSiblings,
  createConversationBranch,
  deleteConversationBranch,
  fetchConversationBranchTree,
  findBranchTreeNode,
  patchConversationActiveBranchPath,
  patchConversationBranchLabel,
  type BranchTreeNodeDto,
} from '@/utils/conversation-branches-api'
import type { ChatTurnItem } from '@/types/chat-turn'
import { computed, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

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

  async function refreshBranchTree() {
    const id = params.getConversationId()
    if (!id) return
    branchLoadError.value = ''
    branchTreeLoading.value = true
    try {
      const tree = await fetchConversationBranchTree(id)
      activeBranchPath.value = tree.activeBranchPath ?? ''
      branchTreeNodes.value = tree.nodes
    } catch (e) {
      branchLoadError.value = e instanceof Error ? e.message : String(e)
    } finally {
      branchTreeLoading.value = false
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
    try {
      await patchConversationActiveBranchPath(id, next || null)
      activeBranchPath.value = next
      await refreshBranchTree()
      await params.onActivePathChanged()
      branchPanelOpen.value = false
    } catch (e) {
      branchLoadError.value = e instanceof Error ? e.message : String(e)
    } finally {
      branchBusy.value = false
    }
  }

  function requestCreateBranchFromTurn(turn: ChatTurnItem) {
    if (branchBusy.value) return
    const forkTurnId = turn.turnId?.trim()
    if (!forkTurnId) return
    pendingCreateTurn.value = turn
    createBranchDialogOpen.value = true
  }

  async function confirmCreateBranch(label: string) {
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
      await createConversationBranch(id, {
        forkTurnId,
        ...(receive?.id ? { forkMessageId: receive.id } : {}),
        ...(trimmed ? { label: trimmed } : {}),
      })
      createBranchDialogOpen.value = false
      pendingCreateTurn.value = null
      await refreshBranchTree()
      await params.onActivePathChanged()
    } catch (e) {
      branchLoadError.value = e instanceof Error ? e.message : String(e)
    } finally {
      branchBusy.value = false
    }
  }

  function cancelCreateBranch() {
    createBranchDialogOpen.value = false
    pendingCreateTurn.value = null
  }

  async function renameBranch(path: string, label: string) {
    const id = params.getConversationId()
    const target = path.trim()
    if (!id || !target || branchBusy.value) return
    branchBusy.value = true
    branchLoadError.value = ''
    try {
      const trimmed = label.trim()
      await patchConversationBranchLabel(id, target, trimmed || null)
      await refreshBranchTree()
    } catch (e) {
      branchLoadError.value = e instanceof Error ? e.message : String(e)
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
    } catch (e) {
      branchLoadError.value = e instanceof Error ? e.message : String(e)
    } finally {
      branchBusy.value = false
    }
  }

  function openBranchPanel() {
    branchPanelOpen.value = true
    void refreshBranchTree()
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
    createBranchDialogOpen,
    forkTurnIdsWithSiblings,
    activeBranchDisplayLabel,
    syncActiveFromIndex,
    refreshBranchTree,
    switchActiveBranch,
    requestCreateBranchFromTurn,
    confirmCreateBranch,
    cancelCreateBranch,
    renameBranch,
    deleteBranch,
    openBranchPanel,
    isForkTurn,
  }
}
