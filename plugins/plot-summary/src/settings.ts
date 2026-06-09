import { asBool, asInt, asString } from './shared/utils.js'
import type { MergedSettings, PluginHost, SidecarConfig, SummarizeTask } from './types.js'

export function k(host: PluginHost, key: string) {
  return host.pluginKey(key)
}

function resolveDefaultSystemPrompt(host: PluginHost) {
  const key = k(host, 'systemPromptTemplateDefault')
  const text = host.t(key)
  return text && text !== key ? text : ''
}

function resolveDefaultSidecarPrompt(host: PluginHost) {
  const key = k(host, 'sidecarSystemPromptTemplateDefault')
  const text = host.t(key)
  return text && text !== key ? text : ''
}

export function parseSidecars(raw: unknown): SidecarConfig[] {
  let arr = raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return []
    try {
      arr = JSON.parse(s)
    } catch {
      return []
    }
  }
  if (!Array.isArray(arr)) return []
  const out: SidecarConfig[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = asString(o.name)
    if (!name) continue
    const id =
      asString(o.id) ||
      name
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
        .replace(/^-+|-+$/g, '') ||
      `sidecar-${out.length}`
    const triggerMode = asString(o.triggerMode)
    const priorityRaw =
      typeof o.priority === 'number' ? Math.round(o.priority) : Number(o.priority)
    out.push({
      id,
      name,
      enabled: o.enabled !== false,
      systemPromptTemplate: asString(o.systemPromptTemplate),
      priority:
        Number.isFinite(priorityRaw) && priorityRaw >= 0
          ? Math.min(200, priorityRaw)
          : 90,
      triggerMode:
        triggerMode === 'keyword' || triggerMode === 'vector' || triggerMode === 'constant'
          ? triggerMode
          : 'constant',
    })
  }
  return out
}

function effectiveSidecars(global: Record<string, unknown>, conv: Record<string, unknown>) {
  if (conv.sidecarEnabled === false) return []
  if (!asBool(global.sidecarEnabled, false)) return []
  return parseSidecars(global.sidecars).filter((s) => s.enabled)
}

export function parseAutoSidecarIdsRaw(raw: unknown, sidecars: SidecarConfig[]) {
  const configured = new Set(sidecars.map((s) => s.id))
  if (Array.isArray(raw)) {
    return raw
      .filter((x) => typeof x === 'string' && configured.has(x.trim()))
      .map((x) => (x as string).trim())
  }
  return sidecars.map((s) => s.id)
}

export function sidecarIdsFromTaskSelection(selected: unknown) {
  const sel = Array.isArray(selected) ? selected : []
  return sel
    .filter((x) => typeof x === 'string' && x.startsWith('sidecar:'))
    .map((x) => (x as string).slice('sidecar:'.length))
}

/** 手动摘要弹窗：记忆上次勾选的剧情 + Sidecar（过滤已删除的 sidecar 配置） */
export function parseManualTaskSelectionRaw(
  raw: unknown,
  sidecars: SidecarConfig[],
): string[] {
  if (!Array.isArray(raw)) return ['memory']
  const configured = new Set(sidecars.map((s) => s.id))
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    if (x === 'memory') {
      if (!out.includes('memory')) out.push('memory')
      continue
    }
    if (!x.startsWith('sidecar:')) continue
    const id = x.slice('sidecar:'.length).trim()
    if (!configured.has(id)) continue
    const token = `sidecar:${id}`
    if (!out.includes(token)) out.push(token)
  }
  return out.length > 0 ? out : ['memory']
}

export function normalizeManualTaskSelection(
  selected: unknown,
  sidecars: SidecarConfig[],
): string[] {
  return parseManualTaskSelectionRaw(selected, sidecars)
}

export async function loadMergedSettings(host: PluginHost): Promise<MergedSettings> {
  const global = await host.plugins.getUserSettings()
  const conv = await host.conversation.getPluginSettings()
  const blockTurns = asInt(
    conv.blockTurns ?? conv.triggerEveryNTurns ?? global.triggerEveryNTurns,
    4,
    500,
  )
  const bufferTurns = asInt(conv.bufferTurns ?? global.bufferTurns, 5, 500)
  const previousSummariesLimit = asInt(global.previousSummariesLimit, 8, 50)
  const entrySortModeRaw = asString(conv.entrySortMode)
  const entrySortMode: 'manual' | 'auto-turn-suffix' =
    entrySortModeRaw === 'manual' ? 'manual' : 'auto-turn-suffix'
  const targetLorebookId = asString(conv.targetLorebookId)
  const convMode = asString(conv.targetLorebookMode)
  const globalMode = asString(global.targetLorebookMode)
  const targetLorebookMode: 'manual' | 'auto' =
    convMode === 'auto' || convMode === 'manual'
      ? convMode
      : globalMode === 'auto' || globalMode === 'manual'
        ? globalMode
        : 'manual'
  const autoLorebookNameTemplate =
    asString(conv.autoLorebookNameTemplate) ||
    asString(global.autoLorebookNameTemplate) ||
    '{{conversationTitle}}-summary'
  const apiConfigId = asString(global.apiConfigId)
  const defaultEntryTriggerMode = asString(global.defaultEntryTriggerMode) || 'vector'
  const sidecarEntryIds =
    conv.sidecarEntryIds && typeof conv.sidecarEntryIds === 'object'
      ? { ...(conv.sidecarEntryIds as Record<string, string>) }
      : {}
  const sidecars = effectiveSidecars(global, conv)
  return {
    global,
    conv,
    apiConfigId,
    targetLorebookId,
    blockTurns,
    bufferTurns,
    previousSummariesLimit,
    entrySortMode,
    defaultEntryTriggerMode,
    systemPromptTemplate:
      asString(global.systemPromptTemplate) || resolveDefaultSystemPrompt(host),
    autoSummarizeEnabled: conv.autoSummarizeEnabled === true,
    nextBlockStart:
      typeof conv.nextBlockStart === 'number'
        ? Math.max(0, Math.round(conv.nextBlockStart))
        : 0,
    lastSummarizedEnd:
      typeof conv.lastSummarizedEnd === 'number'
        ? conv.lastSummarizedEnd
        : typeof conv.lastTriggeredTurnOrdinal === 'number'
          ? conv.lastTriggeredTurnOrdinal
          : undefined,
    sidecarEntryIds,
    sidecars,
    autoSidecarIds: parseAutoSidecarIdsRaw(conv.autoSidecarIds, sidecars),
    manualSummarizeTasks: parseManualTaskSelectionRaw(
      conv.manualSummarizeTasks,
      sidecars,
    ),
    autoSummarizeDefaultEnabled: asBool(global.autoSummarizeDefaultEnabled, false),
    targetLorebookMode,
    autoLorebookNameTemplate,
  }
}

export function sidecarPromptTemplate(host: PluginHost, sc: SidecarConfig) {
  const custom = asString(sc.systemPromptTemplate)
  return custom || resolveDefaultSidecarPrompt(host)
}

export function blockEndFromStart(start: number, blockTurns: number) {
  return start + blockTurns - 1
}

export function shouldAutoTrigger(turnOrdinal: number, settings: MergedSettings) {
  if (!settings.autoSummarizeEnabled) return false
  const start = settings.nextBlockStart ?? 0
  const end = blockEndFromStart(start, settings.blockTurns)
  return turnOrdinal >= end + settings.bufferTurns
}

export function currentAutoRange(settings: MergedSettings) {
  const start = settings.nextBlockStart ?? 0
  return { fromTurn: start, toTurn: blockEndFromStart(start, settings.blockTurns) }
}

export function resolveAutoTasks(settings: MergedSettings): SummarizeTask[] {
  const tasks: SummarizeTask[] = [{ kind: 'memory' }]
  const allowed = new Set(parseAutoSidecarIdsRaw(settings.autoSidecarIds, settings.sidecars))
  for (const sc of settings.sidecars) {
    if (allowed.has(sc.id)) {
      tasks.push({ kind: 'sidecar', sidecar: sc })
    }
  }
  return tasks
}

export function tasksFromSelection(settings: MergedSettings, selected: unknown): SummarizeTask[] {
  const sel = Array.isArray(selected) ? selected : []
  const tasks: SummarizeTask[] = []
  if (sel.includes('memory')) tasks.push({ kind: 'memory' })
  for (const sc of settings.sidecars) {
    if (sel.includes(`sidecar:${sc.id}`)) {
      tasks.push({ kind: 'sidecar', sidecar: sc })
    }
  }
  return tasks
}

export function maxTurnOrdinal(host: PluginHost) {
  const ordinals = host.session.turns ?? []
  let maxOrd = -1
  for (const t of ordinals) {
    if (typeof t.turnOrdinal === 'number' && t.turnOrdinal > maxOrd) {
      maxOrd = t.turnOrdinal
    }
  }
  return maxOrd
}

export function firstAutoTriggerTurnOrdinal(settings: MergedSettings) {
  const start = settings.nextBlockStart ?? 0
  return blockEndFromStart(start, settings.blockTurns) + settings.bufferTurns
}
