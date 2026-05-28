import { formatLoresXmlBlock } from './prompt-xml.js'
import { readLorebooksDocument } from './lorebook-file.js'
import type { Lorebook, LorebookEntry } from './lorebook-types.js'
import {
  type LorebookSettings,
  lorebookSettingsForResolve,
  resolveLorebookSettings,
} from './lorebook-settings.js'
import { readGlobalLorebookSettings } from './user-preferences-file.js'

export type { LorebookSettings } from './lorebook-settings.js'
export {
  LOREBOOK_SETTINGS_DEFAULTS,
  LOREBOOK_MAX_RECURSION_DEPTH,
  normalizeLorebookSettings,
} from './lorebook-settings.js'

export interface LorebookResolveContext {
  /** 当前轮用户输入，用于关键字匹配 */
  userText?: string
  /** 已解析的生效设置；省略则读全局 user-preferences */
  lorebookSettings?: LorebookSettings | null
  /** 会话稀疏覆盖（与全局合并）；与 lorebookSettings 二选一 */
  lorebookSettingsOverride?: Partial<LorebookSettings> | null
}

const MAX_MATCHED_ENTRIES = 64

/**
 * 按会话绑定的资料库 id 顺序合并条目，筛选 enabled 条目并生成注入文本。
 * 支持可选递归：每轮在「扫描语料 + 已命中条目正文」上再匹配关键字。
 */
export async function resolveLorebookInjectionText(
  lorebookIds: string[],
  context: LorebookResolveContext = {},
): Promise<string> {
  if (!lorebookIds.length) return ''
  const doc = await readLorebooksDocument()
  if (!doc) return ''

  let resolved: LorebookSettings
  if (context.lorebookSettings) {
    resolved = context.lorebookSettings
  } else {
    const global = await readGlobalLorebookSettings()
    resolved = resolveLorebookSettings(global, context.lorebookSettingsOverride)
  }
  const settings = lorebookSettingsForResolve(resolved)
  const byId = new Map(doc.lorebooks.map((lb) => [lb.id, lb]))
  const scanSeed = (context.userText ?? '').trim()
  const seenEntryIds = new Set<string>()
  const ordered: LorebookEntry[] = []

  const maxRounds = settings.recursiveEnabled
    ? settings.maxRecursionDepth + 1
    : 1
  let scanLower = scanSeed.toLowerCase()

  for (let round = 0; round < maxRounds; round++) {
    let addedThisRound = false
    for (const lid of lorebookIds) {
      const lb = byId.get(lid)
      if (!lb) continue
      const batch = collectNewMatchesForRound(lb, scanLower, seenEntryIds)
      for (const e of batch) {
        if (ordered.length >= MAX_MATCHED_ENTRIES) break
        seenEntryIds.add(e.id)
        ordered.push(e)
        addedThisRound = true
      }
      if (ordered.length >= MAX_MATCHED_ENTRIES) break
    }
    if (ordered.length >= MAX_MATCHED_ENTRIES) break
    if (!addedThisRound) break
    if (round + 1 >= maxRounds) break
    const appendParts: string[] = []
    for (const lid of lorebookIds) {
      const lb = byId.get(lid)
      if (!lb) continue
      for (const e of lb.entries) {
        if (!seenEntryIds.has(e.id)) continue
        const c = e.content.trim()
        if (c) appendParts.push(c)
      }
    }
    if (appendParts.length === 0) break
    scanLower = `${scanLower}\n\n${appendParts.join('\n\n')}`.toLowerCase()
  }

  const entries = ordered
    .map((e) => ({
      name: e.title.trim() || '未命名',
      content: e.content.trim(),
    }))
    .filter((e) => e.content.length > 0)

  return formatLoresXmlBlock(entries)
}

/** 本轮在 scanLower 上新命中、且未在 seen 中的条目（组内排序） */
function collectNewMatchesForRound(
  lb: Lorebook,
  scanLower: string,
  seenEntryIds: Set<string>,
): LorebookEntry[] {
  const groupOrder = new Map(
    lb.groups
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((g, i) => [g.id, i]),
  )

  return lb.entries
    .filter(
      (e) =>
        e.enabled &&
        !seenEntryIds.has(e.id) &&
        entryMatchesScan(e, scanLower),
    )
    .sort((a, b) => {
      const ga = groupOrder.get(a.groupId) ?? 999
      const gb = groupOrder.get(b.groupId) ?? 999
      if (ga !== gb) return ga - gb
      if (a.order !== b.order) return a.order - b.order
      return b.priority - a.priority
    })
}

function entryMatchesScan(e: LorebookEntry, scanLower: string): boolean {
  if (e.constant) return true
  const keys = e.keys
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0)
  if (keys.length === 0) return false
  if (!scanLower) return false
  return keys.some((key) => scanLower.includes(key))
}
