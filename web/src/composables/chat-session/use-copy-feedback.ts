import { ref } from 'vue'

export function useCopyFeedback() {
  const copiedTurnKey = ref<string | null>(null)
  let copiedTimer: ReturnType<typeof setTimeout> | null = null

  async function copyTurnText(text: string, key: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.left = '-100vw'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      copiedTurnKey.value = key
      if (copiedTimer) clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => {
        copiedTurnKey.value = null
      }, 1400)
    } catch (e) {
      console.warn('copy failed', e)
    }
  }

  return { copiedTurnKey, copyTurnText }
}
