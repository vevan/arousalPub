/** DOC/38 · 插件组装注入描述符（chat depth + order） */

export type PluginPromptInjectionRole = 'system' | 'user' | 'assistant'

export type PluginPromptInjectionPosition = {
  kind: 'chat'
  depth: number
  order?: number
  injectionOrder?: number
}

export type PluginPromptInjection = {
  role: PluginPromptInjectionRole
  content: string
  position: PluginPromptInjectionPosition
}

function isRole(raw: unknown): raw is PluginPromptInjectionRole {
  return raw === 'system' || raw === 'user' || raw === 'assistant'
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
  const order =
    typeof o.order === 'number' && Number.isFinite(o.order)
      ? Math.floor(o.order)
      : undefined
  const injectionOrder =
    typeof o.injectionOrder === 'number' && Number.isFinite(o.injectionOrder)
      ? Math.floor(o.injectionOrder)
      : undefined
  return {
    kind: 'chat',
    depth,
    ...(order !== undefined ? { order } : {}),
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
    out.push({
      role: item.role,
      content: item.content.trim(),
      position: item.position,
    })
  }
  return out.length > 0 ? out : null
}
