/** DOC/38 · 插件组装注入描述符（chat depth + injectionOrder） */

export type PluginPromptInjectionRole = 'system' | 'user' | 'assistant'

/** 与 ST `injection_order` / preset `injectionOrder` 一致；省略时默认 100 */
export const CHAT_INJECTION_ORDER_DEFAULT = 100

export type PluginPromptInjectionPosition = {
  kind: 'chat'
  depth: number
  injectionOrder?: number
}

export type PluginPromptInjection = {
  role: PluginPromptInjectionRole
  content: string
  position: PluginPromptInjectionPosition
}

export function resolvePluginInjectionOrder(
  position: PluginPromptInjectionPosition,
  fallback: number = CHAT_INJECTION_ORDER_DEFAULT,
): number {
  return position.injectionOrder ?? fallback
}

function isRole(raw: unknown): raw is PluginPromptInjectionRole {
  return raw === 'system' || raw === 'user' || raw === 'assistant'
}

function parseInjectionOrder(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  return Math.floor(raw)
}

function parsePosition(raw: unknown): PluginPromptInjectionPosition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (o.kind !== 'chat') return null
  const depth =
    typeof o.depth === 'number' && Number.isFinite(o.depth)
      ? Math.max(0, Math.floor(o.depth))
      : NaN
  if (!Number.isFinite(depth)) return null
  const injectionOrder = parseInjectionOrder(o.injectionOrder)
  return {
    kind: 'chat',
    depth,
    ...(injectionOrder !== undefined ? { injectionOrder } : {}),
  }
}

export function isPluginPromptInjection(raw: unknown): raw is PluginPromptInjection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const o = raw as Record<string, unknown>
  if (!isRole(o.role)) return false
  if (typeof o.content !== 'string' || !o.content.trim()) return false
  const position = parsePosition(o.position)
  return position !== null
}

/** 校验插件 hook 返回的注入描述符数组 */
export function parsePluginPromptInjections(raw: unknown): PluginPromptInjection[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: PluginPromptInjection[] = []
  for (const item of raw) {
    if (!isPluginPromptInjection(item)) return null
    const o = item as Record<string, unknown>
    const position = parsePosition(o.position)
    if (!position) return null
    out.push({
      role: o.role as PluginPromptInjectionRole,
      content: (o.content as string).trim(),
      position,
    })
  }
  return out.length > 0 ? out : null
}
