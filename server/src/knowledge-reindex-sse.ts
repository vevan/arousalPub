import { PassThrough } from 'node:stream'
import type { FastifyReply } from 'fastify'
import {
  reindexKnowledgeBaseExclusive,
  type KnowledgeReindexProgress,
} from './knowledge-vector-index.js'

export type KnowledgeReindexSseEvent =
  | { type: 'start'; files: number; total: number }
  | ({ type: 'progress' } & KnowledgeReindexProgress)
  | { type: 'done'; ok: true; chunkCount: number }
  | { type: 'error'; ok: false; error: string; detail?: string }

function writeSseLine(stream: PassThrough, event: KnowledgeReindexSseEvent): void {
  stream.write(`data: ${JSON.stringify(event)}\n\n`)
}

/** POST ?stream=1：以 SSE 推送知识库重建进度与最终结果 */
export function startKnowledgeBaseReindexSse(
  kbId: string,
  reply: FastifyReply,
  fileCountHint = 0,
): PassThrough {
  const stream = new PassThrough()
  reply.header('Content-Type', 'text/event-stream; charset=utf-8')
  reply.header('Cache-Control', 'no-cache')
  reply.header('Connection', 'keep-alive')
  reply.header('X-Accel-Buffering', 'no')

  void (async () => {
    try {
      const files = Math.max(0, fileCountHint)
      writeSseLine(stream, {
        type: 'start',
        files,
        total: Math.max(1, files + 1),
      })
      const result = await reindexKnowledgeBaseExclusive(kbId, undefined, undefined, {
        onProgress: (progress) => {
          writeSseLine(stream, { type: 'progress', ...progress })
        },
      })
      writeSseLine(stream, {
        type: 'done',
        ok: true,
        chunkCount: result.chunkCount,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      writeSseLine(stream, {
        type: 'error',
        ok: false,
        error: '重建知识库索引失败',
        detail: msg,
      })
    } finally {
      stream.end()
    }
  })()

  return stream
}
