import { PassThrough } from 'node:stream'
import type { FastifyReply } from 'fastify'
import {
  downloadDictVariant,
  type DictDownloadProgress,
} from './hybrid-fts-dict.js'
import {
  normalizeHybridFtsDictVariant,
  normalizeHybridFtsProfile,
  profileRequiresDict,
} from './hybrid-fts-settings.js'

export type HybridFtsDictDownloadSseEvent =
  | { type: 'start'; totalBytes: number | null; variant: string }
  | ({ type: 'progress' } & DictDownloadProgress)
  | { type: 'done'; ok: true; variant: string }
  | { type: 'error'; ok: false; error: string; detail?: string }

function writeSseLine(stream: PassThrough, event: HybridFtsDictDownloadSseEvent): void {
  stream.write(`data: ${JSON.stringify(event)}\n\n`)
}

export function startHybridFtsDictDownloadSse(
  body: { profile?: string; variant?: string },
  reply: FastifyReply,
): PassThrough {
  const stream = new PassThrough()
  reply.header('Content-Type', 'text/event-stream; charset=utf-8')
  reply.header('Cache-Control', 'no-cache')
  reply.header('Connection', 'keep-alive')
  reply.header('X-Accel-Buffering', 'no')

  void (async () => {
    try {
      const profile = normalizeHybridFtsProfile(body.profile)
      if (!profileRequiresDict(profile)) {
        writeSseLine(stream, {
          type: 'error',
          ok: false,
          error: 'profile_does_not_require_dict',
        })
        return
      }
      const variant = normalizeHybridFtsDictVariant(body.variant)
      writeSseLine(stream, { type: 'start', totalBytes: null, variant })
      await downloadDictVariant(profile, variant, (p) => {
        writeSseLine(stream, { type: 'progress', ...p })
      })
      writeSseLine(stream, { type: 'done', ok: true, variant })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      writeSseLine(stream, {
        type: 'error',
        ok: false,
        error: 'dict_download_failed',
        detail: msg,
      })
    } finally {
      stream.end()
    }
  })()

  return stream
}
