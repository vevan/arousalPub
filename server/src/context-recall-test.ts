import { buildAllowedBranchPathsForActive } from './chunk-path.js'
import {
  readConversationIndex,
  resolvedLorebookIds,
  type ConversationIndex,
} from './chat-storage.js'
import { createEmbedding } from './embedding-client.js'
import { loadTurnsForMemoryHits } from './memory-hits.js'
import { searchTurnMemoryVectors } from './memory-store.js'
import { readLorebooksByIds } from './lorebook-file.js'
import { resolveLorebookInjectionParts } from './lorebook-resolve.js'
import type { Lorebook } from './lorebook-types.js'
import { resolveLorebookSettings } from './lorebook-settings.js'
import { buildMemoryEmbeddingCorpus, resolveMemoryCorpusOptions } from './memory-corpus.js'
import { resolveMemorySettings } from './memory-settings.js'
import { readGlobalLorebookSettings, readGlobalMemorySettings } from './user-preferences-file.js'

const PREVIEW_MAX_LEN = 240
const TOP_K_MIN = 1
const TOP_K_MAX = 64

export interface ContextRecallTestRequest {
  query: string
  topK: number
}

export interface ContextRecallMemoryHit {
  turnId: string
  turnOrdinal: number
  score: number
  preview: string
  content: string
}

export interface ContextRecallLoreHit {
  lorebookId: string
  lorebookName: string
  entryId: string
  title: string
  mode: 'keyword' | 'vector' | 'constant'
  score?: number
  preview: string
  content: string
}

export interface ContextRecallTestResult {
  query: string
  topK: number
  memory: {
    hits: ContextRecallMemoryHit[]
    embeddingError?: string
  }
  lore: {
    lorebookIds: string[]
    hits: ContextRecallLoreHit[]
  }
}

export function parseContextRecallTestBody(
  raw: unknown,
):
  | { ok: true; request: ContextRecallTestRequest }
  | { ok: false; error: 'context_recall_query_required' | 'context_recall_topk_invalid' } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'context_recall_query_required' }
  }
  const b = raw as Record<string, unknown>
  const query = typeof b.query === 'string' ? b.query.trim() : ''
  if (!query) {
    return { ok: false, error: 'context_recall_query_required' }
  }
  let topK = typeof b.topK === 'number' ? Math.trunc(b.topK) : 10
  if (Number.isNaN(topK)) topK = 10
  if (topK < TOP_K_MIN || topK > TOP_K_MAX) {
    return { ok: false, error: 'context_recall_topk_invalid' }
  }
  return { ok: true, request: { query, topK } }
}

function previewText(text: string): string {
  const t = text.trim()
  if (t.length <= PREVIEW_MAX_LEN) return t
  return `${t.slice(0, PREVIEW_MAX_LEN)}…`
}

function lorebookNameMap(
  lorebookIds: string[],
  byId: Map<string, Lorebook>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const id of lorebookIds) {
    const lb = byId.get(id)
    const name = lb?.name.trim() || id
    out.set(name, id)
    out.set(id, id)
  }
  return out
}

export async function runContextRecallTest(
  conversationId: string,
  request: ContextRecallTestRequest,
  idx: ConversationIndex,
): Promise<ContextRecallTestResult> {
  const { query, topK } = request
  const lorebookIds = resolvedLorebookIds(idx)
  const activeBranchPath = idx.activeBranchPath ?? ''

  const memoryHits: ContextRecallMemoryHit[] = []
  let embeddingError: string | undefined

  const globalMemory = await readGlobalMemorySettings()
  const effectiveMemory = resolveMemorySettings(globalMemory, idx.memorySettings)
  const corpusOptions = await resolveMemoryCorpusOptions(effectiveMemory)

  const emb = await createEmbedding(query, conversationId)
  if (!emb) {
    embeddingError = 'embedding_unavailable'
  } else {
    const rawHits = await searchTurnMemoryVectors(
      conversationId,
      emb.vector,
      query,
      topK,
      new Set(),
      undefined,
      buildAllowedBranchPathsForActive(activeBranchPath),
    )
    const items = await loadTurnsForMemoryHits(conversationId, rawHits)
    for (const { turn, score } of items) {
      const content = buildMemoryEmbeddingCorpus(turn, corpusOptions)
      memoryHits.push({
        turnId: turn.turnId,
        turnOrdinal: turn.turnOrdinal,
        score,
        preview: previewText(content),
        content,
      })
    }
  }

  const globalLore = await readGlobalLorebookSettings()
  const effectiveLore = resolveLorebookSettings(globalLore, idx.lorebookSettings)
  const parts = await resolveLorebookInjectionParts(lorebookIds, {
    userText: query,
    scanCorpus: query,
    conversationId,
    lorebookSettings: effectiveLore,
  })

  const loreHits: ContextRecallLoreHit[] = []
  for (const m of parts.matchedLore) {
    const content = m.entry.content.trim()
    loreHits.push({
      lorebookId: m.lorebookId,
      lorebookName: m.lorebookName,
      entryId: m.entry.id,
      title: m.entry.title.trim() || m.entry.id,
      mode: m.mode,
      score: m.score,
      preview: previewText(content),
      content,
    })
  }

  const lorebooks = await readLorebooksByIds(lorebookIds)
  const byId = new Map(lorebooks.map((lb) => [lb.id, lb]))
  const nameToId = lorebookNameMap(lorebookIds, byId)

  for (const g of parts.constantLoreGroups) {
    const lorebookId = nameToId.get(g.lorebookName.trim()) ?? g.lorebookName
    const lorebookName = g.lorebookName.trim() || lorebookId
    for (const e of g.entries) {
      const content = e.content.trim()
      if (!content) continue
      loreHits.push({
        lorebookId,
        lorebookName,
        entryId: `constant:${lorebookId}:${e.name}`,
        title: e.name.trim() || '未命名',
        mode: 'constant',
        preview: previewText(content),
        content,
      })
    }
  }

  return {
    query,
    topK,
    memory: {
      hits: memoryHits,
      ...(embeddingError ? { embeddingError } : {}),
    },
    lore: {
      lorebookIds,
      hits: loreHits,
    },
  }
}
