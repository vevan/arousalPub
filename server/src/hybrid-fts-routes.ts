import type { FastifyInstance, FastifyReply } from 'fastify'
import { ApiErrorCodes } from './api-error-codes.js'
import { getTokenizerCatalog } from './hybrid-fts-catalog.js'
import { getProfileDictStatus } from './hybrid-fts-dict.js'
import { startHybridFtsDictDownloadSse } from './hybrid-fts-dict-download-sse.js'
import { normalizeHybridFtsProfile } from './hybrid-fts-settings.js'

export function registerHybridFtsRoutes(app: FastifyInstance): void {
  app.get('/api/hybrid-fts/catalog', async (_request, reply) => {
    try {
      return { catalog: getTokenizerCatalog() }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.validation_failed })
    }
  })

  app.get<{ Querystring: { profile?: string } }>(
    '/api/hybrid-fts/dict-status',
    async (request, reply) => {
      try {
        const raw = request.query.profile
        if (typeof raw !== 'string' || !raw.trim()) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.hybrid_fts_profile_invalid })
        }
        const profile = normalizeHybridFtsProfile(raw)
        if (profile !== raw.trim()) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.hybrid_fts_profile_invalid })
        }
        return await getProfileDictStatus(profile)
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.validation_failed })
      }
    },
  )

  app.post<{
    Body: { profile?: string; variant?: string }
    Querystring: { stream?: string }
  }>(
    '/api/hybrid-fts/dict-download',
    async (request, reply: FastifyReply) => {
      const wantStream =
        request.query.stream === '1' || request.query.stream === 'true'
      if (!wantStream) {
        return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
      }
      const stream = startHybridFtsDictDownloadSse(request.body ?? {}, reply)
      return reply.send(stream)
    },
  )
}
