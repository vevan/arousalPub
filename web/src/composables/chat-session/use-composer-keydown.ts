import { normalizeComposerEnterMode } from '@/utils/chat-display-settings'
import { nextTick, type ComputedRef, type Ref } from 'vue'

export function useComposerKeydown(opts: {
  userInput: Ref<string>
  canSend: ComputedRef<boolean>
  composerEnterMode: () => string
  send: () => void | Promise<void>
}) {
  function insertComposerNewline(e: KeyboardEvent) {
    const el = e.target
    if (!(el instanceof HTMLTextAreaElement)) return
    e.preventDefault()
    const start = el.selectionStart ?? opts.userInput.value.length
    const end = el.selectionEnd ?? start
    const v = opts.userInput.value
    opts.userInput.value = `${v.slice(0, start)}\n${v.slice(end)}`
    void nextTick(() => {
      el.selectionStart = el.selectionEnd = start + 1
    })
  }

  function onComposerKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.isComposing) return

    const mode = normalizeComposerEnterMode(opts.composerEnterMode())
    const mod = e.ctrlKey || e.metaKey

    if (mode === 'enter-send') {
      if (mod) {
        insertComposerNewline(e)
        return
      }
      if (e.shiftKey) return
      e.preventDefault()
      if (opts.canSend.value) void opts.send()
      return
    }

    if (!mod) return
    e.preventDefault()
    if (opts.canSend.value) void opts.send()
  }

  return { onComposerKeydown }
}
