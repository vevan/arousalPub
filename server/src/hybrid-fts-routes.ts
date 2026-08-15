import type { FastifyInstance, FastifyReply } from 'fastify'
import { ApiErrorCodes } from './api-error-codes.js'
import { getTokenizerCatalog } from './hybrid-fts-catalog.js'
import {
  DictImportError,
  getProfileDictStatus,
  importLinderaDictZipStream,
  maxLinderaImportBytes,
} from './hybrid-fts-dict.js'
import { startHybridFtsDictDownloadSse } from './hybrid-fts-dict-download-sse.js'
import {
  isHybridFtsProfile,
  normalizeHybridFtsProfile,
} from './hybrid-fts-settings.js'
import { getCurrentUserId } from './user-context.js'

function dictImportErrorCode(
  reason: DictImportError['reason'],
): string {
  switch (reason) {
    case 'variant_not_importable':
      return ApiErrorCodes.hybrid_fts_dict_import_not_supported
    case 'dict_variant_invalid':
      return ApiErrorCodes.hybrid_fts_dict_variant_invalid
    case 'package_mismatch':
      return ApiErrorCodes.hybrid_fts_dict_package_mismatch
    case 'archive_invalid':
      return ApiErrorCodes.hybrid_fts_dict_archive_invalid
    case 'install_conflict':
      return ApiErrorCodes.hybrid_fts_dict_install_conflict
    default:
      return ApiErrorCodes.hybrid_fts_dict_import_failed
  }
}

/** neologd ~291 MiB；路由级上限须覆盖官方最大包 */
const LINDERA_IMPORT_BODY_LIMIT = 320 * 1024 * 1024

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

  app.post<{
    Querystring: { profile?: string }
  }>(
    '/api/hybrid-fts/dict-import',
    {
      bodyLimit: LINDERA_IMPORT_BODY_LIMIT,
    },
    async (request, reply) => {
      try {
        const ct = request.headers['content-type'] ?? ''
        if (!ct.includes('multipart/form-data')) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.multipart_payload_required })
        }

        const rawProfile = request.query.profile
        if (typeof rawProfile !== 'string' || !isHybridFtsProfile(rawProfile)) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.hybrid_fts_profile_invalid })
        }
        if (rawProfile !== 'lindera') {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.hybrid_fts_dict_import_not_supported })
        }

        const fileSizeLimit = maxLinderaImportBytes()
        const part = await request.file({
          limits: {
            files: 1,
            fields: 4,
            fileSize: fileSizeLimit,
          },
        })
        if (!part) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.missing_file_field })
        }
        if (part.fieldname !== 'file') {
          await part.toBuffer().catch(() => undefined)
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.missing_file_field })
        }

        const userId = getCurrentUserId()
        const variant = await importLinderaDictZipStream(part.file, { userId })
        if (part.file.truncated) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.hybrid_fts_dict_package_mismatch })
        }

        const status = await getProfileDictStatus('lindera', userId)
        const row = status.variants.find((v) => v.id === variant)
        return {
          ok: true as const,
          profile: 'lindera' as const,
          variant,
          downloaded: row?.downloaded === true,
        }
      } catch (e) {
        if (e instanceof DictImportError) {
          const status =
            e.reason === 'install_conflict'
              ? 409
              : e.reason === 'package_mismatch' ||
                  e.reason === 'archive_invalid' ||
                  e.reason === 'variant_not_importable' ||
                  e.reason === 'dict_variant_invalid'
                ? 400
                : 500
          return reply.status(status).send({
            error: dictImportErrorCode(e.reason),
            detail: e.message,
          })
        }
        app.log.error(e)
        return reply
          .status(500)
          .send({ error: ApiErrorCodes.hybrid_fts_dict_import_failed })
      }
    },
  )
}
