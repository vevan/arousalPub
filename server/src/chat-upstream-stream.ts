import type { FastifyBaseLogger, FastifyRequest } from 'fastify'
import { PassThrough, Readable, type Transform, Writable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'

/**
 * @deprecated 客户端断线不再 abort 上游；主路径请用 generation cancel。
 * 仍保留供单测与对照。
 */
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

export type ChatUpstreamIdleAbortHandle = {
  signal: AbortSignal
  /** 收到上游字节时调用，重置空闲计时 */
  touch: () => void
  /** 流结束或放弃时清理定时器 */
  dispose: () => void
}

/**
 * 合并显式 cancel 与「空闲超时」：有 touch 则续命，断流超过 idleMs 才 abort。
 * 创建后立即开始计时（覆盖等首包 / 连接挂起）。
 */
export function createChatUpstreamIdleAbort(
  clientAbort: AbortController,
  idleMs: number,
): ChatUpstreamIdleAbortHandle {
  const idleAbort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const clearTimer = (): void => {
    if (timer == null) return
    clearTimeout(timer)
    timer = null
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    clearTimer()
    clientAbort.signal.removeEventListener('abort', onClientAbort)
  }

  const arm = (): void => {
    clearTimer()
    if (disposed || idleAbort.signal.aborted || clientAbort.signal.aborted) return
    timer = setTimeout(() => {
      timer = null
      if (!idleAbort.signal.aborted) idleAbort.abort()
    }, idleMs)
  }

  const onClientAbort = (): void => {
    dispose()
  }
  clientAbort.signal.addEventListener('abort', onClientAbort)

  const touch = (): void => {
    if (disposed || idleAbort.signal.aborted || clientAbort.signal.aborted) return
    arm()
  }

  arm()

  return {
    signal: AbortSignal.any([clientAbort.signal, idleAbort.signal]),
    touch,
    dispose,
  }
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
  const source = Readable.fromWeb(body as NodeWebReadableStream<Uint8Array>)
  guardReadableStreamError(source, log, 'chat upstream SSE source')
  guardReadableStreamError(tap, log, 'chat upstream SSE tap')
  const out = source.pipe(tap)
  guardReadableStreamError(out, log, 'chat upstream SSE pipeline')
  return out
}

/**
 * 尽力向客户端写 SSE；客户端断开时忽略写失败，不销毁 upstreamPipeline。
 * upstreamPipeline 应已包含 tap（含 persist 行）。
 */
export function attachBestEffortClientSseSink(
  upstreamPipeline: Readable,
  clientOut: PassThrough,
  log: FastifyBaseLogger,
): void {
  const sink = new Writable({
    write(chunk, _enc, cb) {
      if (!clientOut.destroyed && clientOut.writable) {
        try {
          clientOut.write(chunk)
        } catch (err) {
          log.warn({ err }, 'chat client sse write ignored')
        }
      }
      cb()
    },
    final(cb) {
      if (!clientOut.destroyed && !clientOut.writableEnded) {
        try {
          clientOut.end()
        } catch (err) {
          log.warn({ err }, 'chat client sse end ignored')
        }
      }
      cb()
    },
  })
  sink.on('error', (err) => {
    log.warn({ err }, 'chat client sse sink')
  })
  clientOut.on('error', (err) => {
    log.warn({ err }, 'chat client sse out')
  })
  upstreamPipeline.pipe(sink)
  upstreamPipeline.on('error', (err) => {
    if (!clientOut.destroyed && !clientOut.writableEnded) {
      try {
        clientOut.destroy(err instanceof Error ? err : new Error(String(err)))
      } catch {
        /* ignore */
      }
    }
  })
}
