import { ref } from 'vue'

function toErrorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e) return e
  return String(e)
}

/**
 * Shared loading / errorText / async submit pattern for settings & list views.
 */
export function useAsyncAction(initialLoading = false) {
  const loading = ref(initialLoading)
  const errorText = ref('')

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    loading.value = true
    errorText.value = ''
    try {
      return await fn()
    } catch (e) {
      errorText.value = toErrorMessage(e)
      return undefined
    } finally {
      loading.value = false
    }
  }

  return { loading, errorText, run }
}
