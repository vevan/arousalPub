import { readLorebooksByIds } from './lorebook-file.js'
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
import type {
  ConstantLoreItem,
  TrimmableLoreEntry,
} from './prompt-budget-trim.js'
import {
  worldTextFromTrimState,
  worldTextsFromTrimState,
} from './prompt-budget-trim.js'

export type { LorebookSettings } from './lorebook-settings.js'
export {
  LOREBOOK_SETTINGS_DEFAULTS,
  LOREBOOK_MAX_RECURSION_DEPTH,
  normalizeLorebookSettings,
} from './lorebook-settings.js'

export interface LorebookResolveContext {
  userText?: string
  scanCorpus?: string
  conversationId?: string
  lorebookSettings?: LorebookSettings | null
  lorebookSettingsOverride?: Partial<LorebookSettings> | null
}

export interface LorebookInjectionParts {
  constantLore: ConstantLoreItem[]
  matchedLore: TrimmableLoreEntry[]
}

type TaggedLoreEntry = { lorebookId: string; entry: LorebookEntry }

export async function resolveLorebookInjectionText(
  lorebookIds: string[],
  context: LorebookResolveContext = {},
): Promise<string> {
  const parts = await resolveLorebookInjectionParts(lorebookIds, context)
  return formatWorldFromLoreParts(parts)
}

/** 合并 before+after（调试 / 单测用） */
export function formatWorldFromLoreParts(parts: LorebookInjectionParts): string {
  return worldTextFromTrimState({
    constantLore: parts.constantLore,
    matchedLore: parts.matchedLore,
    memoryItems: [],
    knowledgeItems: [],
    historyMessages: [],
  })
}

export function formatWorldTextsFromLoreParts(parts: LorebookInjectionParts): {
  worldBefore: string
  worldAfter: string
} {
  return worldTextsFromTrimState({
    constantLore: parts.constantLore,
    matchedLore: parts.matchedLore,
    memoryItems: [],
    knowledgeItems: [],
    historyMessages: [],
  })
}

export async function resolveLorebookInjectionParts(
  lorebookIds: string[],
  context: LorebookResolveContext = {},
): Promise<LorebookInjectionParts> {
  if (!lorebookIds.length) {
    return { constantLore: [], matchedLore: [] }
  }
  const lorebooks = await readLorebooksByIds(lorebookIds)
  if (!lorebooks.length) {
    return { constantLore: [], matchedLore: [] }
  }

  let resolved: LorebookSettings
  if (context.lorebookSettings) {
    resolved = context.lorebookSettings
  } else {
    const global = await readGlobalLorebookSettings()
    resolved = resolveLorebookSettings(global, context.lorebookSettingsOverride)
  }
  const settings = lorebookSettingsForResolve(resolved)
  const keywordTopK = settings.keywordTopK
  const byId = new Map(lorebooks.map((lb) => [lb.id, lb]))
  const scanSeed = (context.scanCorpus ?? context.userText ?? '').trim()
  const seenEntryIds = new Set<string>()

  const constantLore: ConstantLoreItem[] = []
  for (const lid of lorebookIds) {
    const lb = byId.get(lid)
    if (!lb) continue
    const constants = lb.entries
      .filter(
        (e) =>
          e.enabled &&
          e.content.trim() &&
          resolveEntryTriggerMode(e) === 'constant' &&
          !seenEntryIds.has(e.id),
      )
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order
        return a.id.localeCompare(b.id)
      })
    for (const e of constants) {
      seenEntryIds.add(e.id)
      constantLore.push({
        lorebookId: lid,
        lorebookName: lb.name.trim() || lid,
        entry: e,
      })
    }
  }

  const keywordOrdered: TaggedLoreEntry[] = []
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
        if (keywordOrdered.length >= keywordTopK) break
        seenEntryIds.add(e.id)
        keywordOrdered.push({ lorebookId: lid, entry: e })
        addedThisRound = true
      }
      if (keywordOrdered.length >= keywordTopK) break
    }
    if (keywordOrdered.length >= keywordTopK) break
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

  const matchedLore: TrimmableLoreEntry[] = keywordOrdered.map((t) => ({
    lorebookId: t.lorebookId,
    lorebookName: byId.get(t.lorebookId)?.name.trim() || t.lorebookId,
    entry: t.entry,
    mode: 'keyword' as const,
    score: t.entry.priority,
  }))

  if (settings.vectorEnabled && scanSeed.length > 0) {
    const vectorHits = await collectVectorMatches(
      lorebookIds,
      byId,
      scanSeed,
      settings.vectorTopK,
      seenEntryIds,
      context.conversationId,
    )
    for (const hit of vectorHits) {
      seenEntryIds.add(hit.entry.id)
      matchedLore.push({
        lorebookId: hit.lorebookId,
        lorebookName: byId.get(hit.lorebookId)?.name.trim() || hit.lorebookId,
        entry: hit.entry,
        mode: 'vector',
        score: hit.score,
        scoreKind: hit.scoreKind,
      })
    }
  }

  return { constantLore, matchedLore }
}

async function collectVectorMatches(
  lorebookIds: string[],
  byId: Map<string, Lorebook>,
  queryText: string,
  topK: number,
  seenEntryIds: Set<string>,
  conversationId?: string,
): Promise<Array<TaggedLoreEntry & { score: number; scoreKind: 'rrf' | 'vector_fallback' }>> {
  const emb = await createEmbedding(queryText, conversationId)
  if (!emb) return []

  type Ranked = {
    lorebookId: string
    entry: LorebookEntry
    score: number
    scoreKind: 'rrf' | 'vector_fallback'
  }
  const ranked: Ranked[] = []

  for (const lid of lorebookIds) {
    const lb = byId.get(lid)
    if (!lb) continue
    const hits = await searchLorebookEntryVectors(
      lid,
      emb.vector,
      queryText,
      topK,
      seenEntryIds,
    )
    const entryById = new Map(lb.entries.map((e) => [e.id, e]))
    for (const hit of hits) {
      const e = entryById.get(hit.entryId)
      if (!e || !e.enabled || seenEntryIds.has(e.id)) continue
      if (resolveEntryTriggerMode(e) !== 'vector') continue
      if (!e.content.trim()) continue
      ranked.push({
        lorebookId: lid,
        entry: e,
        score: hit.score,
        scoreKind: hit.scoreKind,
      })
    }
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.entry.priority - a.entry.priority
  })

  const out: Array<
    TaggedLoreEntry & { score: number; scoreKind: 'rrf' | 'vector_fallback' }
  > = []
  const taken = new Set<string>()
  for (const r of ranked) {
    if (out.length >= topK) break
    if (taken.has(r.entry.id)) continue
    taken.add(r.entry.id)
    out.push(r)
  }
  return out
}

/** 本轮 keyword 新命中（不含 constant / vector） */
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
  if (mode !== 'keyword') return false
  const keys = e.keys
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0)
  if (keys.length === 0) return false
  if (!scanLower) return false
  return keys.some((key) => scanLower.includes(key))
}
