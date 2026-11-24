/**
 * 每轮每工具成功调用上限（宿主 generic）。
 * - 核心检索默认 1
 * - phase=read / 未标注：默认 1
 * - phase=write：默认不限（Infinity）
 * - manifest `maxCallsPerTurn` 可覆盖（1..32）
 */

import {
  CORE_KNOWLEDGE_SEARCH_TOOL,
  CORE_LORE_SEARCH_TOOL,
  CORE_MEMORY_SEARCH_TOOL,
} from './host-search-tools.js'
import type { AgentToolPhase } from './agent-prose-phase.js'

export const AGENT_TOOL_MAX_CALLS_CAP = 32

export function clampToolMaxCallsPerTurn(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const n = Math.round(raw)
  if (n < 1) return undefined
  return Math.min(AGENT_TOOL_MAX_CALLS_CAP, n)
}

export function defaultMaxCallsForPhase(
  phase: AgentToolPhase | undefined,
): number {
  return phase === 'write' ? Number.POSITIVE_INFINITY : 1
}

export function resolveToolMaxCallsPerTurn(opts: {
  name: string
  phase?: AgentToolPhase
  manifestMaxCallsPerTurn?: number
}): number {
  const fromManifest = clampToolMaxCallsPerTurn(opts.manifestMaxCallsPerTurn)
  if (fromManifest !== undefined) return fromManifest
  const n = opts.name.trim()
  if (
    n === CORE_LORE_SEARCH_TOOL ||
    n === CORE_MEMORY_SEARCH_TOOL ||
    n === CORE_KNOWLEDGE_SEARCH_TOOL
  ) {
    return 1
  }
  return defaultMaxCallsForPhase(opts.phase)
}

export function toolCallBudgetRemaining(
  maxCalls: number,
  successfulCalls: number,
): number {
  if (!Number.isFinite(maxCalls)) return Number.POSITIVE_INFINITY
  return Math.max(0, maxCalls - Math.max(0, successfulCalls))
}

export function isToolCallBudgetExhausted(
  maxCalls: number,
  successfulCalls: number,
): boolean {
  return toolCallBudgetRemaining(maxCalls, successfulCalls) <= 0
}
