import { createEmbedding } from './embedding-client.js'
import { readKnowledgeBasesByIds, readKnowledgeChunksDocument } from './knowledge-base-file.js'
import {
  normalizeKnowledgeSettings,
  resolveKnowledgeSettings,
  type KnowledgeSettingsOverride,
} from './knowledge-settings.js'
import { readGlobalKnowledgeSettings } from './user-preferences-file.js'
import { searchKnowledgeChunkVectors } from './knowledge-vector-store.js'
import {
  formatKnowledgeXml,
  knowledgeDocumentDisplayName,
  type KnowledgeXmlChunk,
} from './knowledge-xml.js'

export interface KnowledgeHitItem {
  kbId: string
  kbName: string
  fileId: string
  fileName: string
  chunkId: string
  ordinal: number
  text: string
  score: number
}

export interface KnowledgeRecallResult {
  items: KnowledgeHitItem[]
  knowledgeText: string
}

/**
 * 按绑定知识库 hybrid TopK；多库合并后截断总 TopK。
 * queryText：建议 scanCorpus 或本轮 userText。
 */
export async function recallKnowledgeForConversation(params: {
  knowledgeBaseIds: string[]
  queryText: string
  conversationId?: string
  knowledgeSettings?: KnowledgeSettingsOverride | null
  /** 覆盖会话/全局 topK（命中测试展示条数） */
  topK?: number
}): Promise<KnowledgeRecallResult> {
  const empty: KnowledgeRecallResult = { items: [], knowledgeText: '' }
  if (!params.knowledgeBaseIds.length) return empty

  const global = await readGlobalKnowledgeSettings()
  const settings = resolveKnowledgeSettings(
    normalizeKnowledgeSettings(global),
    params.knowledgeSettings,
  )
  if (!settings.enabled) return empty

  const queryText = params.queryText.trim()
  if (!queryText) return empty

  // 先校验绑定的知识库仍存在，避免为已删除/无效 id 白付一次 embedding
  const kbs = await readKnowledgeBasesByIds(params.knowledgeBaseIds)
  if (!kbs.length) return empty

  const emb = await createEmbedding(queryText, params.conversationId)
  if (!emb?.vector.length) return empty

  const topK =
    typeof params.topK === 'number' && Number.isFinite(params.topK)
      ? Math.max(1, Math.min(64, Math.trunc(params.topK)))
      : settings.topK

  const nameById = new Map(kbs.map((k) => [k.id, k.name]))
  const aliasByKb = new Map(kbs.map((k) => [k.id, k.fileAliases ?? {}]))
  const fileNameCache = new Map<string, string>()

  async function fileName(kbId: string, fileId: string): Promise<string> {
    const key = `${kbId}:${fileId}`
    const cached = fileNameCache.get(key)
    if (cached) return cached
    const doc = await readKnowledgeChunksDocument(kbId)
    const f = doc?.files.find((x) => x.fileId === fileId)
    const n = knowledgeDocumentDisplayName(
      f?.name || fileId,
      aliasByKb.get(kbId)?.[fileId],
    )
    fileNameCache.set(key, n)
    return n
  }

  const merged: KnowledgeHitItem[] = []
  for (const kb of kbs) {
    const hits = await searchKnowledgeChunkVectors(
      kb.id,
      emb.vector,
      queryText,
      topK,
    )
    for (const h of hits) {
      merged.push({
        kbId: kb.id,
        kbName: nameById.get(kb.id) || kb.id,
        fileId: h.fileId,
        fileName: await fileName(kb.id, h.fileId),
        chunkId: h.chunkId,
        ordinal: h.ordinal,
        text: h.text,
        score: h.score,
      })
    }
  }

  merged.sort((a, b) => b.score - a.score)
  const items = merged.slice(0, topK)
  const xmlChunks: KnowledgeXmlChunk[] = items.map((i) => ({
    kbName: i.kbName,
    fileName: i.fileName,
    ordinal: i.ordinal,
    text: i.text,
  }))
  return {
    items,
    knowledgeText: formatKnowledgeXml(xmlChunks),
  }
}
