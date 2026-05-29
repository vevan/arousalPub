import { formatLoresXmlBlock } from './prompt-xml.js'
import { readLorebooksDocument } from './lorebook-file.js'
import type { Lorebook, LorebookEntry } from './lorebook-types.js'
import { resolveEntryTriggerMode } from './lorebook-entry-utils.js'
import { createEmbedding } from './embedding-client.js'
import { searchLorebookEntryVectors } from './lorebook-vector-store.js'
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
  /** 当前轮用户输入（无 scanCorpus 时的回退） */
  userText?: string
  /** §13.5：userText + memory + history 合并语料 */
  scanCorpus?: string
  /** 已解析的生效设置；省略则读全局 user-preferences */
  lorebookSettings?: LorebookSettings | null
  /** 会话稀疏覆盖（与全局合并）；与 lorebookSettings 二选一 */
  lorebookSettingsOverride?: Partial<LorebookSettings> | null
}

const MAX_MATCHED_ENTRIES = 64

/**
 * 按会话绑定的资料库 id 顺序合并条目，筛选 enabled 条目并生成注入文本。
 * 关键字/恒定 → 可选递归；向量触发 → 单次 TopK（与关键字结果合并）。
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
  const scanSeed = (context.scanCorpus ?? context.userText ?? '').trim()
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
      const batch = collectNewKeywordMatchesForRound(lb, scanLower, seenEntryIds)
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

  if (settings.vectorEnabled && scanSeed.length > 0 && ordered.length < MAX_MATCHED_ENTRIES) {
    const vectorHits = await collectVectorMatches(
      lorebookIds,
      byId,
      scanSeed,
      settings.vectorTopK,
      seenEntryIds,
    )
    for (const e of vectorHits) {
      if (ordered.length >= MAX_MATCHED_ENTRIES) break
      seenEntryIds.add(e.id)
      ordered.push(e)
    }
  }

  const entries = ordered
    .map((e) => ({
      name: e.title.trim() || '未命名',
      content: e.content.trim(),
    }))
    .filter((e) => e.content.length > 0)

  return formatLoresXmlBlock(entries)
}

async function collectVectorMatches(
  lorebookIds: string[],
  byId: Map<string, Lorebook>,
  queryText: string,
  topK: number,
  seenEntryIds: Set<string>,
): Promise<LorebookEntry[]> {
  const emb = await createEmbedding(queryText)
  if (!emb) return []

  type Ranked = { entry: LorebookEntry; score: number }
  const ranked: Ranked[] = []

  for (const lid of lorebookIds) {
    const lb = byId.get(lid)
    if (!lb) continue
    const hits = await searchLorebookEntryVectors(
      lid,
      emb.vector,
      topK,
      seenEntryIds,
    )
    const entryById = new Map(lb.entries.map((e) => [e.id, e]))
    for (const hit of hits) {
      const e = entryById.get(hit.entryId)
      if (!e || !e.enabled || seenEntryIds.has(e.id)) continue
      if (resolveEntryTriggerMode(e) !== 'vector') continue
      if (!e.content.trim()) continue
      ranked.push({ entry: e, score: hit.score })
    }
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.entry.priority - a.entry.priority
  })

  const out: LorebookEntry[] = []
  const taken = new Set<string>()
  for (const r of ranked) {
    if (out.length >= topK) break
    if (taken.has(r.entry.id)) continue
    taken.add(r.entry.id)
    out.push(r.entry)
  }
  return out
}

/** 本轮在 scanLower 上新命中、且未在 seen 中的条目（关键字 + 恒定；不含向量） */
function collectNewKeywordMatchesForRound(
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
        entryMatchesKeywordScan(e, scanLower),
    )
    .sort((a, b) => {
      const ga = groupOrder.get(a.groupId) ?? 999
      const gb = groupOrder.get(b.groupId) ?? 999
      if (ga !== gb) return ga - gb
      if (a.order !== b.order) return a.order - b.order
      return b.priority - a.priority
    })
}

function entryMatchesKeywordScan(e: LorebookEntry, scanLower: string): boolean {
  const mode = resolveEntryTriggerMode(e)
  if (mode === 'vector') return false
  if (mode === 'constant') return true
  const keys = e.keys
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0)
  if (keys.length === 0) return false
  if (!scanLower) return false
  return keys.some((key) => scanLower.includes(key))
}
