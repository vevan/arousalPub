import { PassThrough } from 'node:stream'
import type { FastifyReply } from 'fastify'
import {
  planConversationMemoryReindex,
  reindexConversationMemory,
  type MemoryReindexError,
  type MemoryReindexProgress,
  type MemoryReindexResult,
} from './memory-index.js'

export type MemoryReindexSseEvent =
  | ({ type: 'start' } & Awaited<ReturnType<typeof planConversationMemoryReindex>>)
  | ({ type: 'progress' } & MemoryReindexProgress)
  | ({ type: 'done' } & MemoryReindexResult)
  | ({ type: 'error' } & MemoryReindexError)

function writeSseLine(stream: PassThrough, event: MemoryReindexSseEvent): void {
  stream.write(`data: ${JSON.stringify(event)}\n\n`)
}

/** POST ?stream=1：以 SSE 推送重建进度与最终结果 */
export function startConversationMemoryReindexSse(
  conversationId: string,
  reply: FastifyReply,
): PassThrough {
  const stream = new PassThrough()
  reply.header('Content-Type', 'text/event-stream; charset=utf-8')
  reply.header('Cache-Control', 'no-cache')
  reply.header('Connection', 'keep-alive')
  reply.header('X-Accel-Buffering', 'no')

  void (async () => {
    try {
      const plan = await planConversationMemoryReindex(conversationId)
      writeSseLine(stream, { type: 'start', ...plan })
      const result = await reindexConversationMemory(conversationId, {
        onProgress: (progress) => {
          writeSseLine(stream, { type: 'progress', ...progress })
        },
      })
      if (!result.ok) {
        writeSseLine(stream, { type: 'error', ...result })
      } else {
        writeSseLine(stream, { type: 'done', ...result })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      writeSseLine(stream, {
        type: 'error',
        ok: false,
        error: '重建远期记忆索引失败',
        detail: msg,
      })
    } finally {
      stream.end()
    }
  })()

  return stream
}
