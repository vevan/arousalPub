import type { FastifyBaseLogger, FastifyRequest } from 'fastify'
import { Readable, type Transform } from 'node:stream'

/** 客户端断开时 abort 上游 fetch，避免空转直到 timeout。 */
export function bindChatClientAbort(
  request: FastifyRequest,
  abort: AbortController,
): () => void {
  const onClose = () => {
    if (!abort.signal.aborted) abort.abort()
  }
  request.raw.on('close', onClose)
  return () => {
    request.raw.off('close', onClose)
  }
}

export function mergeChatUpstreamAbortSignals(
  clientAbort: AbortController,
  timeoutMs: number,
): AbortSignal {
  return AbortSignal.any([
    clientAbort.signal,
    AbortSignal.timeout(timeoutMs),
  ])
}

/** 防止 Readable 的 error 事件未处理导致进程退出。 */
export function guardReadableStreamError(
  stream: NodeJS.EventEmitter,
  log: FastifyBaseLogger,
  label: string,
): void {
  stream.on('error', (err: unknown) => {
    log.warn({ err }, label)
  })
}

export function pipeUpstreamSseBody(
  body: ReadableStream<Uint8Array>,
  tap: Transform,
  log: FastifyBaseLogger,
): Readable {
  const source = Readable.fromWeb(body)
  guardReadableStreamError(source, log, 'chat upstream SSE source')
  guardReadableStreamError(tap, log, 'chat upstream SSE tap')
  const out = source.pipe(tap)
  guardReadableStreamError(out, log, 'chat upstream SSE pipeline')
  return out
}
