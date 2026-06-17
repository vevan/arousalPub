import { nextTick, ref } from 'vue'

export interface ChatScrollerHandle {
  scrollToBottom: () => void
  /** @returns 是否成功调用组件 API */
  scrollToItem: (index: number) => boolean
}

export interface ChatScrollReasoningOpts {
  toggleReasoningChain: (turnOrdinal: number) => void
  getTurnIndex?: (turnOrdinal: number) => number
}

/** 思维链展开后虚拟列表量高完成前的等待上限 */
const LAYOUT_STABLE_MAX_MS = 520
/** 连续多少帧 scrollHeight 不变视为布局稳定 */
const LAYOUT_STABLE_FRAMES = 3

function assistantTurnEl(
  scrollRoot: HTMLElement | null,
  turnOrdinal: number,
): HTMLElement | null {
  const el = scrollRoot?.querySelector(
    `.turn--assistant[data-turn-ordinal="${turnOrdinal}"]`,
  )
  return el instanceof HTMLElement ? el : null
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

export function useChatScroll(reasoning?: ChatScrollReasoningOpts) {
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

  function computeAssistantScrollTop(turnOrdinal: number): number | null {
    const scrollEl = chatScrollEl.value
    const assistant = assistantTurnEl(scrollEl, turnOrdinal)
    if (!scrollEl || !assistant) return null

    return (
      scrollEl.scrollTop +
      assistant.getBoundingClientRect().top -
      scrollEl.getBoundingClientRect().top
    )
  }

  function scrollAssistantTurnToTopInstant(turnOrdinal: number): boolean {
    const scrollEl = chatScrollEl.value
    const top = computeAssistantScrollTop(turnOrdinal)
    if (!scrollEl || top == null) return false
    scrollEl.scrollTop = top
    return true
  }

  async function waitForAssistantLayoutStable(turnOrdinal: number): Promise<boolean> {
    const scrollEl = chatScrollEl.value
    if (!scrollEl) return false

    const index = reasoning?.getTurnIndex?.(turnOrdinal) ?? -1
    let lastHeight = -1
    let stableFrames = 0
    const deadline = performance.now() + LAYOUT_STABLE_MAX_MS
    let scrollToItemUsed = false

    while (performance.now() < deadline) {
      await nextTick()
      await waitFrames(1)

      if (!assistantTurnEl(scrollEl, turnOrdinal)) {
        if (!scrollToItemUsed && index >= 0 && chatScroller.value?.scrollToItem(index)) {
          scrollToItemUsed = true
          stableFrames = 0
          lastHeight = -1
          continue
        }
        stableFrames = 0
        lastHeight = -1
        continue
      }

      const height = scrollEl.scrollHeight
      if (height === lastHeight) {
        stableFrames += 1
        if (stableFrames >= LAYOUT_STABLE_FRAMES) return true
      } else {
        stableFrames = 0
        lastHeight = height
      }
    }

    return assistantTurnEl(scrollEl, turnOrdinal) != null
  }

  async function scrollAssistantTurnToTopAfterLayout(turnOrdinal: number): Promise<void> {
    const ready = await waitForAssistantLayoutStable(turnOrdinal)
    if (!ready) return
    scrollAssistantTurnToTopInstant(turnOrdinal)
  }

  function toggleReasoningChain(turnOrdinal: number): void {
    reasoning?.toggleReasoningChain(turnOrdinal)
    void scrollAssistantTurnToTopAfterLayout(turnOrdinal)
  }

  function reasoningOrdinalFromHovered(): number | null {
    const scrollEl = chatScrollEl.value
    const hovered = scrollEl?.querySelector(
      '.turn--assistant:hover, .turn--assistant.is-hover',
    ) as HTMLElement | null
    const root = hovered?.querySelector(
      '.reasoning-chain[data-turn-ordinal]',
    )
    if (!(root instanceof HTMLElement)) return null
    const ord = Number(root.dataset.turnOrdinal)
    return Number.isFinite(ord) ? ord : null
  }

  function latestReasoningOrdinalInDom(): number | null {
    const scrollEl = chatScrollEl.value
    if (!scrollEl) return null

    let best = -1
    for (const el of scrollEl.querySelectorAll(
      '.reasoning-chain[data-turn-ordinal]',
    )) {
      if (!(el instanceof HTMLElement)) continue
      const ord = Number(el.dataset.turnOrdinal)
      if (Number.isFinite(ord) && ord > best) best = ord
    }
    return best >= 0 ? best : null
  }

  function toggleReasoningPanelForOrdinal(turnOrdinal: number): void {
    toggleReasoningChain(turnOrdinal)
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
    toggleReasoningChain,
  }
}
