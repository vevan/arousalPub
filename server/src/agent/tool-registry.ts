/** 进程内 tool 注册表（阶段 1 fixture / 阶段 2 聚合前的宿主侧入口） */

import type { AgentToolDefinition } from './types.js'

export type AgentToolHandler = (
  argsJson: string,
  signal: AbortSignal | undefined,
) => Promise<string>

type ToolEntry = {
  handler: AgentToolHandler
  definition: AgentToolDefinition
}

const tools = new Map<string, ToolEntry>()

function asDefinition(
  name: string,
  definition?: AgentToolDefinition,
): AgentToolDefinition {
  if (definition?.type === 'function' && definition.function?.name) {
    return definition
  }
  return {
    type: 'function',
    function: {
      name,
      description: name,
      parameters: { type: 'object', additionalProperties: true },
    },
  }
}

export function registerAgentTool(
  name: string,
  handler: AgentToolHandler,
  definition?: AgentToolDefinition,
): void {
  const n = name.trim()
  if (!n) throw new Error('invalid_tool_name')
  tools.set(n, { handler, definition: asDefinition(n, definition) })
}

export function unregisterAgentTool(name: string): void {
  tools.delete(name.trim())
}

export function clearAgentTools(): void {
  tools.clear()
}

export function listRegisteredAgentToolNames(): string[] {
  return [...tools.keys()].sort()
}

/** 当前已注册工具的 OpenAI tools[] 定义（供出站 payload） */
export function listRegisteredAgentToolDefinitions(): AgentToolDefinition[] {
  return listRegisteredAgentToolNames().map((n) => tools.get(n)!.definition)
}

export async function runRegisteredTool(
  name: string,
  argsJson: string,
  signal?: AbortSignal,
): Promise<{ ok: true; content: string } | { ok: false; code: string; detail?: string }> {
  if (signal?.aborted) {
    return { ok: false, code: 'cancelled' }
  }
  const entry = tools.get(name.trim())
  if (!entry) {
    return { ok: false, code: 'tool_not_found', detail: name }
  }
  try {
    const content = await entry.handler(argsJson, signal)
    if (signal?.aborted) {
      return { ok: false, code: 'cancelled' }
    }
    return { ok: true, content: typeof content === 'string' ? content : String(content) }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { ok: false, code: 'tool_failed', detail: detail.slice(0, 2000) }
  }
}
