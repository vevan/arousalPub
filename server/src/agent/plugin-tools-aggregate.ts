/**
 * 聚合核心 tools + 插件 manifest.tools，并 dispatch 到 runTool / 核心实现。
 */

import { createPluginServerHostApi } from '../plugin-system/host-api.js'
import { loadEnabledServerPlugins } from '../plugin-system/loader.js'
import { readPluginManifest } from '../plugin-system/manifest.js'
import {
  assertPluginPermission,
  pluginAuthFailureStatus,
} from '../plugin-permissions.js'
import {
  clampAgentToolResult,
  raceWithToolTimeout,
} from './agent-limits.js'
import { normalizeAgentToolPhase } from './agent-prose-phase.js'
import type { AgentToolDefinition } from './types.js'
import type { AgentSearchContext } from './host-search-tools.js'
import {
  isCoreAgentToolName,
  listCoreAgentToolDefinitions,
  runCoreAgentTool,
} from './host-search-tools.js'

export type PluginToolDecl = {
  pluginId: string
  name: string
  definition: AgentToolDefinition
  permissions: string[]
  /** DOC/53 §16：write = 正文后可变状态；缺省按 read 侧处理 */
  phase?: 'read' | 'write'
}

/** OpenAI function.name：字母数字下划线短横线，无点号 */
const OPENAI_TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

export function isOpenAiSafeToolName(name: string): boolean {
  return OPENAI_TOOL_NAME_RE.test(name)
}

function asToolDefinition(
  name: string,
  description: string | undefined,
  parameters: Record<string, unknown> | undefined,
): AgentToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      ...(description ? { description } : { description: name }),
      parameters: parameters ?? {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  }
}

/** 从已启用插件 manifest 收集 tools 声明 */
export async function collectPluginToolDecls(
  userId?: string,
): Promise<PluginToolDecl[]> {
  const loaded = await loadEnabledServerPlugins(userId)
  const out: PluginToolDecl[] = []
  const seen = new Set<string>()

  for (const p of loaded) {
    const manifest = await readPluginManifest(p.id)
    const tools = manifest?.tools
    if (!tools?.length) continue
    for (const t of tools) {
      const name = t.name.trim()
      if (!name || seen.has(name)) continue
      if (!isOpenAiSafeToolName(name)) continue
      if (isCoreAgentToolName(name)) continue
      seen.add(name)
      const phase = normalizeAgentToolPhase(t.phase)
      out.push({
        pluginId: p.id,
        name,
        permissions: [...t.permissions],
        definition: asToolDefinition(name, t.description, t.parameters),
        ...(phase ? { phase } : {}),
      })
    }
  }
  return out
}

export async function collectAgentToolDefinitions(
  userId?: string,
): Promise<AgentToolDefinition[]> {
  const pluginDecls = await collectPluginToolDecls(userId)
  return [
    ...listCoreAgentToolDefinitions(),
    ...pluginDecls.map((d) => d.definition),
  ]
}

/** phase=write 的工具名集合（核心检索均为 read，不在此列） */
export async function collectWriteAgentToolNames(
  userId?: string,
): Promise<Set<string>> {
  const decls = await collectPluginToolDecls(userId)
  return new Set(decls.filter((d) => d.phase === 'write').map((d) => d.name))
}

export async function dispatchAgentToolCall(opts: {
  name: string
  argsJson: string
  conversationId: string
  signal?: AbortSignal
  userId?: string
  searchContext?: AgentSearchContext
}): Promise<
  { ok: true; content: string } | { ok: false; code: string; detail?: string }
> {
  if (opts.signal?.aborted) {
    return { ok: false, code: 'cancelled' }
  }
  const name = opts.name.trim()
  if (!name) return { ok: false, code: 'tool_not_found' }

  try {
    return await raceWithToolTimeout(async (toolSignal) => {
      if (toolSignal.aborted) return { ok: false as const, code: 'cancelled' }

      if (isCoreAgentToolName(name)) {
        const core = await runCoreAgentTool(
          name,
          opts.conversationId,
          opts.argsJson,
          opts.searchContext,
        )
        if (!core.ok) return core
        return {
          ok: true as const,
          content: clampAgentToolResult(core.content),
        }
      }

      const decls = await collectPluginToolDecls(opts.userId)
      const decl = decls.find((d) => d.name === name)
      if (!decl) {
        return { ok: false as const, code: 'tool_not_found', detail: name }
      }

      for (const perm of decl.permissions) {
        const auth = await assertPluginPermission(
          decl.pluginId,
          perm,
          opts.userId,
        )
        if (!auth.ok) {
          return {
            ok: false as const,
            code: auth.code,
            detail: `status=${pluginAuthFailureStatus(auth.code)}`,
          }
        }
      }

      const loaded = await loadEnabledServerPlugins(opts.userId)
      const plugin = loaded.find((p) => p.id === decl.pluginId)
      if (!plugin || typeof plugin.module.runTool !== 'function') {
        return {
          ok: false as const,
          code: 'tool_not_supported',
          detail: decl.pluginId,
        }
      }

      const api = createPluginServerHostApi(decl.pluginId)
      const result = await plugin.module.runTool(
        name,
        {
          arguments: opts.argsJson,
          conversationId: opts.conversationId,
          signal: toolSignal,
        },
        api,
      )
      if (toolSignal.aborted || opts.signal?.aborted) {
        return { ok: false as const, code: 'cancelled' }
      }
      if (!result || typeof result !== 'object') {
        return { ok: false as const, code: 'tool_failed', detail: 'invalid_result' }
      }
      if ((result as { ok?: unknown }).ok === false) {
        const r = result as { code?: string; detail?: string }
        return {
          ok: false as const,
          code: typeof r.code === 'string' ? r.code : 'tool_failed',
          detail:
            typeof r.detail === 'string'
              ? r.detail.slice(0, 500)
              : undefined,
        }
      }
      const content = (result as { content?: unknown }).content
      const raw =
        typeof content === 'string' ? content : JSON.stringify(result)
      return { ok: true as const, content: clampAgentToolResult(raw) }
    }, opts.signal)
  } catch (e) {
    const code =
      e && typeof e === 'object' && 'code' in e
        ? String((e as { code?: unknown }).code ?? '')
        : ''
    if (code === 'cancelled' || code === 'tool_timeout') {
      return { ok: false, code }
    }
    const detail = e instanceof Error ? e.message : String(e)
    return { ok: false, code: 'tool_failed', detail: detail.slice(0, 500) }
  }
}
