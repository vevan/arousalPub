import { ref } from 'vue'

/** 思维链展开态（按 turnOrdinal）；虚拟列表复用组件时需挂 session，非持久化存储 */
export function useReasoningChainOpen() {
  const openOrdinals = ref<Set<number>>(new Set())

  function isReasoningChainOpen(turnOrdinal: number): boolean {
    return openOrdinals.value.has(turnOrdinal)
  }

  function toggleReasoningChain(turnOrdinal: number): void {
    const next = new Set(openOrdinals.value)
    if (next.has(turnOrdinal)) next.delete(turnOrdinal)
    else next.add(turnOrdinal)
    openOrdinals.value = next
  }

  function clearReasoningChainOpen(): void {
    openOrdinals.value = new Set()
  }

  return {
    isReasoningChainOpen,
    toggleReasoningChain,
    clearReasoningChainOpen,
  }
}
