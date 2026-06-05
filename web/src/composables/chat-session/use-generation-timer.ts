import { ref } from 'vue'

export function useGenerationTimer() {
  const generationTimerAnchor = ref<number | null>(null)
  const generationTimerTick = ref(0)
  let generationTimerHandle: ReturnType<typeof setInterval> | null = null

  function startGenerationTimer() {
    if (generationTimerHandle) {
      clearInterval(generationTimerHandle)
      generationTimerHandle = null
    }
    generationTimerAnchor.value = performance.now()
    generationTimerTick.value = performance.now()
    generationTimerHandle = setInterval(() => {
      generationTimerTick.value = performance.now()
    }, 100)
  }

  function stopGenerationTimer(): number {
    if (generationTimerHandle) {
      clearInterval(generationTimerHandle)
      generationTimerHandle = null
    }
    const anchor = generationTimerAnchor.value
    generationTimerAnchor.value = null
    if (anchor == null) return 0
    return Math.round(generationTimerTick.value - anchor)
  }

  function generationElapsedMs(): number {
    const anchor = generationTimerAnchor.value
    if (anchor == null) return 0
    return Math.round(generationTimerTick.value - anchor)
  }

  function dispose(): void {
    if (generationTimerHandle) {
      clearInterval(generationTimerHandle)
      generationTimerHandle = null
    }
  }

  return {
    startGenerationTimer,
    stopGenerationTimer,
    generationElapsedMs,
    dispose,
  }
}
