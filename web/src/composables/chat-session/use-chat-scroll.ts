import { nextTick, ref } from 'vue'

export interface ChatScrollerHandle {
  scrollToBottom: () => void
  /** @returns 是否成功调用组件 API */
  scrollToItem: (index: number) => boolean
}

export function useChatScroll() {
  const chatScrollEl = ref<HTMLElement | null>(null)
  const chatScroller = ref<ChatScrollerHandle | null>(null)

  function registerChatScroller(comp: ChatScrollerHandle | null) {
    chatScroller.value = comp
  }

  function scrollChatElToBottom(el: HTMLElement) {
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    el.scrollTop = max
  }

  function isNearBottom(thresholdPx = 180) {
    const el = chatScrollEl.value
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx
  }

  async function scrollChatToBottom(opts?: { onlyIfNearBottom?: boolean }) {
    if (opts?.onlyIfNearBottom && !isNearBottom()) return

    for (let attempt = 0; attempt < 12; attempt++) {
      await nextTick()
      const scroller = chatScroller.value
      if (scroller) {
        scroller.scrollToBottom()
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              scroller.scrollToBottom()
              resolve()
            })
          })
        })
        scroller.scrollToBottom()
        return
      }
      const el = chatScrollEl.value
      if (el) {
        scrollChatElToBottom(el)
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              scrollChatElToBottom(el)
              resolve()
            })
          })
        })
        scrollChatElToBottom(el)
        return
      }
      await new Promise((r) => setTimeout(r, 16))
    }
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
    chatScroller,
    registerChatScroller,
    scrollChatToBottom,
    isNearBottom,
    onGlobalKeyR,
  }
}
