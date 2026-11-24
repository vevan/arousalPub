import type { AgentToolCall } from './types.js'

type Slot = {
  id: string
  name: string
  arguments: string
}

/** 累加 OpenAI 流式 delta.tool_calls（按 index） */
export class ToolCallAccumulator {
  private readonly slots = new Map<number, Slot>()

  applyDeltaToolCalls(raw: unknown): void {
    if (!Array.isArray(raw)) return
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const index =
        typeof o.index === 'number' && Number.isFinite(o.index)
          ? Math.floor(o.index)
          : 0
      let slot = this.slots.get(index)
      if (!slot) {
        slot = { id: '', name: '', arguments: '' }
        this.slots.set(index, slot)
      }
      if (typeof o.id === 'string' && o.id) slot.id = o.id
      const fn = o.function
      if (fn && typeof fn === 'object') {
        const f = fn as Record<string, unknown>
        if (typeof f.name === 'string' && f.name) slot.name = f.name
        if (typeof f.arguments === 'string') slot.arguments += f.arguments
      }
    }
  }

  /** 合并为完整 tool_calls；缺 id/name 的槽位丢弃 */
  toToolCalls(): AgentToolCall[] {
    const indexes = [...this.slots.keys()].sort((a, b) => a - b)
    const out: AgentToolCall[] = []
    for (const i of indexes) {
      const s = this.slots.get(i)
      if (!s?.id || !s.name) continue
      out.push({
        id: s.id,
        type: 'function',
        function: { name: s.name, arguments: s.arguments || '{}' },
      })
    }
    return out
  }

  reset(): void {
    this.slots.clear()
  }
}
