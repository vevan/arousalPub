import { nextTick, ref } from 'vue'

export function useChatScroll() {
  const chatScrollEl = ref<HTMLElement | null>(null)

  function scrollChatElToBottom(el: HTMLElement) {
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    el.scrollTop = max
  }

  async function scrollChatToBottom() {
    await nextTick()
    const el = chatScrollEl.value
    if (!el) return
    const apply = () => scrollChatElToBottom(el)
    apply()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          apply()
          resolve()
        })
      })
    })
    apply()
  }

  function lastReasoningChainInChat(): HTMLDetailsElement | null {
    const chains = document.querySelectorAll('.chat-body details.reasoning-chain')
    const last = chains[chains.length - 1]
    return last instanceof HTMLDetailsElement ? last : null
  }

  function onGlobalKeyR(e: KeyboardEvent) {
    if (e.key !== 'r' && e.key !== 'R') return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target as HTMLElement | null
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable)
    ) {
      return
    }
    const hovered = document.querySelector(
      '.turn--assistant:hover, .turn--assistant.is-hover',
    ) as HTMLElement | null
    const target =
      hovered?.querySelector('details.reasoning-chain') ?? lastReasoningChainInChat()
    if (target instanceof HTMLDetailsElement) {
      target.open = !target.open
      e.preventDefault()
    }
  }

  return {
    chatScrollEl,
    scrollChatToBottom,
    onGlobalKeyR,
  }
}
