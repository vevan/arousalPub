import { nextTick, ref } from 'vue'

export interface ChatScrollerHandle {
  scrollToBottom: () => void
  /** @returns 是否成功调用组件 API */
  scrollToItem: (index: number) => boolean
}

function waitFrames(frameCount = 2): Promise<void> {
  return new Promise((resolve) => {
    let left = frameCount
    const step = () => {
      left -= 1
      if (left <= 0) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

export function useChatScroll() {
  const chatScrollEl = ref<HTMLElement | null>(null)
  const chatScroller = ref<ChatScrollerHandle | null>(null)

  function registerChatScroller(comp: ChatScrollerHandle | null) {
    chatScroller.value = comp
  }

  function scrollChatElToBottom(el: HTMLElement) {
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
  }

  function isScrollElAtBottom(el: HTMLElement, thresholdPx = 4): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx
  }

  function isNearBottom(thresholdPx = 180) {
    const el = chatScrollEl.value
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx
  }

  async function scrollChatToBottom(opts?: { onlyIfNearBottom?: boolean }) {
    if (opts?.onlyIfNearBottom && !isNearBottom()) return

    for (let attempt = 0; attempt < 20; attempt++) {
      await nextTick()
      await waitFrames(2)

      const scroller = chatScroller.value
      if (scroller) scroller.scrollToBottom()

      const el = chatScrollEl.value
      if (el && el.clientHeight > 0) {
        scrollChatElToBottom(el)
        if (isScrollElAtBottom(el)) {
          await waitFrames(2)
          scrollChatElToBottom(el)
          if (isScrollElAtBottom(el)) return
        }
      }

      await new Promise((r) => setTimeout(r, 16))
    }
  }

  function reasoningOrdinalFromHovered(): number | null {
    const scrollEl = chatScrollEl.value
    const hovered = scrollEl?.querySelector(
      '.turn--assistant:hover, .turn--assistant.is-hover',
    ) as HTMLElement | null
    const details = hovered?.querySelector(
      'details.reasoning-chain[data-turn-ordinal]',
    )
    if (!(details instanceof HTMLDetailsElement)) return null
    const ord = Number(details.dataset.turnOrdinal)
    return Number.isFinite(ord) ? ord : null
  }

  function latestReasoningOrdinalInDom(): number | null {
    const scrollEl = chatScrollEl.value
    if (!scrollEl) return null

    let best = -1
    for (const el of scrollEl.querySelectorAll(
      'details.reasoning-chain[data-turn-ordinal]',
    )) {
      if (!(el instanceof HTMLDetailsElement)) continue
      const ord = Number(el.dataset.turnOrdinal)
      if (Number.isFinite(ord) && ord > best) best = ord
    }
    return best >= 0 ? best : null
  }

  function toggleReasoningPanelForOrdinal(turnOrdinal: number): void {
    const scrollEl = chatScrollEl.value
    const summary = scrollEl?.querySelector(
      `.reasoning-chain[data-turn-ordinal="${turnOrdinal}"] .reasoning-chain__summary`,
    )
    if (summary instanceof HTMLElement) summary.click()
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
    const ord =
      reasoningOrdinalFromHovered() ?? latestReasoningOrdinalInDom()
    if (ord != null) {
      toggleReasoningPanelForOrdinal(ord)
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
