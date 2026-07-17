import { createEmbedding } from './embedding-client.js'
import { embedTextsInBatches, isEmbeddingBatchOk } from './embedding-batch.js'
import {
  resolveEmbeddingApiCredentials,
  type ResolvedEmbeddingCredentials,
} from './embedding-credential-resolve.js'
import { createKeyedCoalesceScheduler } from './keyed-serial-queue.js'
import { generateShortId } from './short-id.js'
import { sliceKnowledgeText } from './knowledge-chunk.js'
import {
  extractKnowledgeText,
  KnowledgeTextExtractError,
} from './knowledge-text-extract.js'
import {
  readKnowledgeBaseById,
  writeKnowledgeBase,
  writeKnowledgeChunksDocument,
} from './knowledge-base-file.js'
import type {
  KnowledgeBase,
  KnowledgeChunksDocument,
  KnowledgeFileChunks,
} from './knowledge-base-types.js'
import {
  deleteKnowledgeVectorIndex,
  replaceKnowledgeVectorIndex,
  type DocChunkVectorRow,
} from './knowledge-vector-store.js'
import {
  normalizeKnowledgeSettings,
  type KnowledgeSettings,
} from './knowledge-settings.js'
import { readGlobalKnowledgeSettings } from './user-preferences-file.js'
import {
  getFileLibraryMeta,
  resolveFileLibraryContent,
} from './file-library-storage.js'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

const knowledgeIndexScheduler = createKeyedCoalesceScheduler<string>({
  keyOf: (kbId) => kbId,
  process: async (kbId) => {
    await reindexKnowledgeBase(kbId)
  },
  onError: (e) => {
    // eslint-disable-next-line no-console
    console.warn('[knowledge-vector-index] reindex failed:', e)
  },
})

export function scheduleKnowledgeBaseReindex(kbId: string): void {
  knowledgeIndexScheduler.schedule(kbId)
}

export function scheduleKnowledgeBasesReindex(kbIds: string[]): void {
  for (const id of kbIds) scheduleKnowledgeBaseReindex(id)
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of stream) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
  }
  return Buffer.concat(chunks)
}

async function loadDocumentText(
  fileId: string,
): Promise<{ text: string; name: string; updatedAt: string } | null> {
  const meta = await getFileLibraryMeta(fileId)
  if (!meta || meta.kind !== 'document') return null
  const resolved = await resolveFileLibraryContent(fileId)
  if (!resolved) return null
  const buf = await streamToBuffer(
    createReadStream(resolved.contentPath) as unknown as Readable,
  )
  try {
    const text = extractKnowledgeText({
      buffer: buf,
      mime: meta.mime,
      filename: meta.name,
    })
    return { text, name: meta.name, updatedAt: meta.updatedAt }
  } catch (e) {
    if (e instanceof KnowledgeTextExtractError) {
      // eslint-disable-next-line no-console
      console.warn(`[knowledge-vector-index] skip ${fileId}: ${e.code}`)
      return null
    }
    throw e
  }
}

export type KnowledgeReindexStage =
  | 'planning'
  | 'extracting'
  | 'embedding'
  | 'writing'
  | 'finalizing'

export interface KnowledgeReindexProgress {
  done: number
  total: number
  stage: KnowledgeReindexStage
  stageDone?: number
  stageTotal?: number
  files?: number
  chunks?: number
}

export async function reindexKnowledgeBase(
  kbId: string,
  creds?: ResolvedEmbeddingCredentials,
  settings?: KnowledgeSettings,
  options?: { onProgress?: (progress: KnowledgeReindexProgress) => void },
): Promise<{ chunkCount: number }> {
  const kb = await readKnowledgeBaseById(kbId)
  if (!kb) return { chunkCount: 0 }

  const marking: KnowledgeBase = {
    ...kb,
    indexStatus: 'indexing',
    updatedAt: new Date().toISOString(),
  }
  delete marking.indexError
  await writeKnowledgeBase(marking)

  const fileTotal = kb.fileIds.length
  let done = 0
  let total = Math.max(1, fileTotal + 1)
  let chunkCountKnown = 0

  const tick = (
    stage: KnowledgeReindexStage,
    stageDone?: number,
    stageTotal?: number,
  ) => {
    options?.onProgress?.({
      done,
      total,
      stage,
      stageDone,
      stageTotal,
      files: fileTotal,
      chunks: chunkCountKnown,
    })
  }

  tick('planning', 0, total)

  try {
    const effSettings =
      settings ??
      normalizeKnowledgeSettings(await readGlobalKnowledgeSettings())

    const fileChunks: KnowledgeFileChunks[] = []
    const embedItems: { key: string; text: string }[] = []

    let fileDone = 0
    for (const fileId of kb.fileIds) {
      const loaded = await loadDocumentText(fileId)
      if (loaded) {
        const pieces = sliceKnowledgeText(loaded.text, {
          chunkSizeChars: effSettings.chunkSizeChars,
          chunkOverlapChars: effSettings.chunkOverlapChars,
        })
        const chunks = pieces.map((text, ordinal) => ({
          chunkId: `${fileId}-${ordinal}-${generateShortId().slice(0, 4)}`,
          ordinal,
          text,
        }))
        fileChunks.push({
          fileId,
          updatedAt: loaded.updatedAt,
          name: loaded.name,
          chunks,
        })
        for (const c of chunks) {
          embedItems.push({ key: c.chunkId, text: c.text })
        }
      }
      fileDone += 1
      done = fileDone
      tick('extracting', fileDone, fileTotal)
    }

    chunkCountKnown = embedItems.length
    total = fileTotal + chunkCountKnown + 1
    done = fileTotal
    tick('extracting', fileTotal, fileTotal)

    let embeddingModel: string | undefined
    let embeddingDimensions: number | null = null

    const rows: DocChunkVectorRow[] = []
    if (embedItems.length > 0) {
      const resolvedCreds = creds ?? (await resolveEmbeddingApiCredentials())
      if (resolvedCreds) {
        let reported = 0
        const batch = await embedTextsInBatches(resolvedCreds, embedItems, {
          onProgress: (progress) => {
            reported = progress.completedItems
            done = fileTotal + reported
            tick('embedding', reported, embedItems.length)
          },
        })
        if (!isEmbeddingBatchOk(batch)) {
          throw new Error(batch.error || 'embedding_batch_failed')
        }
        embeddingModel = batch.model
        embeddingDimensions = resolvedCreds.embeddingDimensions
        for (const fc of fileChunks) {
          for (const c of fc.chunks) {
            const vector = batch.vectors.get(c.chunkId)
            if (!vector?.length) continue
            rows.push({
              chunkId: c.chunkId,
              kbId,
              fileId: fc.fileId,
              ordinal: c.ordinal,
              text: c.text,
              vector,
            })
          }
        }
      } else {
        let embedded = 0
        for (const fc of fileChunks) {
          for (const c of fc.chunks) {
            const emb = await createEmbedding(c.text)
            embedded += 1
            done = fileTotal + embedded
            tick('embedding', embedded, embedItems.length)
            if (!emb) continue
            embeddingModel = emb.model
            rows.push({
              chunkId: c.chunkId,
              kbId,
              fileId: fc.fileId,
              ordinal: c.ordinal,
              text: c.text,
              vector: emb.vector,
            })
          }
        }
        const resolved = await resolveEmbeddingApiCredentials()
        embeddingDimensions = resolved?.embeddingDimensions ?? null
      }
    }

    // 有切片但向量不完整：视为失败，避免「ready 但召回为空/缺片」的假健康状态
    if (embedItems.length > 0 && rows.length < embedItems.length) {
      throw new Error(
        `embedding_incomplete: ${rows.length}/${embedItems.length} chunks embedded`,
      )
    }

    done = fileTotal + chunkCountKnown
    tick('writing', 0, 1)

    const chunksDoc: KnowledgeChunksDocument = {
      schemaVersion: 1,
      kbId,
      embeddingModel,
      embeddingDimensions,
      updatedAt: new Date().toISOString(),
      files: fileChunks,
    }
    await writeKnowledgeChunksDocument(chunksDoc)

    if (rows.length === 0) {
      await deleteKnowledgeVectorIndex(kbId)
    } else {
      await replaceKnowledgeVectorIndex(kbId, rows)
    }

    const doneKb: KnowledgeBase = {
      ...kb,
      indexStatus: 'ready',
      indexedAt: new Date().toISOString(),
      chunkCount: rows.length,
      updatedAt: new Date().toISOString(),
    }
    delete doneKb.indexError
    await writeKnowledgeBase(doneKb)

    done = total
    tick('finalizing', 1, 1)
    return { chunkCount: rows.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const failed: KnowledgeBase = {
      ...kb,
      indexStatus: 'error',
      indexError: msg,
      updatedAt: new Date().toISOString(),
    }
    await writeKnowledgeBase(failed)
    throw e
  }
}
