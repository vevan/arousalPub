import { ref, watch } from 'vue'

/**
 * Open/close state for a delete-confirm dialog (id + optional label).
 * `confirm(fn)` runs the delete; closes only on success; rethrows on failure.
 */
export function useDeleteConfirmDialog() {
  const open = ref(false)
  const targetId = ref<string | null>(null)
  const targetLabel = ref('')
  const confirming = ref(false)

  function askDelete(id: string, label = '') {
    targetId.value = id
    targetLabel.value = label
    open.value = true
  }

  function close() {
    open.value = false
  }

  watch(open, (isOpen) => {
    if (!isOpen) {
      targetId.value = null
      targetLabel.value = ''
      confirming.value = false
    }
  })

  async function confirm(
    fn: (id: string) => void | Promise<void>,
  ): Promise<boolean> {
    const id = targetId.value
    if (!id || confirming.value) return false
    confirming.value = true
    try {
      await fn(id)
      close()
      return true
    } finally {
      confirming.value = false
    }
  }

  return {
    open,
    targetId,
    targetLabel,
    confirming,
    askDelete,
    close,
    confirm,
  }
}
