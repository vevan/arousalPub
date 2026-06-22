import { onMounted, onUnmounted, ref } from 'vue'

const NARROW_LAYOUT_QUERY = '(max-width: 40rem)'

/** 与全站 `--app-breakpoint-narrow` / 移动主布局断点一致 */
export function useNarrowLayout() {
  const isNarrow = ref(false)
  let mq: MediaQueryList | null = null

  function sync() {
    isNarrow.value = mq?.matches ?? false
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    mq = window.matchMedia(NARROW_LAYOUT_QUERY)
    sync()
    mq.addEventListener('change', sync)
  })

  onUnmounted(() => {
    mq?.removeEventListener('change', sync)
  })

  return { isNarrow }
}
