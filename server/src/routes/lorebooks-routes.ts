import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from '../api-error-codes.js'
import { assertValidLorebooksPayload, LOREBOOKS_BULK_PUT_MAX_JSON_BYTES, readLorebookById, readLorebooksDocument, readLorebooksIndexSummary, writeLorebook, writeLorebooksDocument, LOREBOOK_ID_RE, type LorebooksDocument } from '../lorebook-file.js'
import { tryAcquireLorebooksBulkPutSlot } from '../lorebooks-bulk-put-limit.js'
import { getCurrentUserId } from '../user-context.js'
import { scheduleLorebookVectorReindex } from '../lorebook-vector-index.js'
import { convertStLorebookToLorebook, isStLorebookJson, previewStLorebookImport, ST_LOREBOOK_IMPORT_MAX_ENTRIES } from '../st-lorebook-import.js'

export function registerLorebooksRoutes(app: FastifyInstance): void {
  app.get('/api/lorebooks', async (_request, reply) => {
    try {
      const data = await readLorebooksDocument()
      return (
        data ?? {
          schemaVersion: 1,
          savedAt: '',
          lorebooks: [],
        }
      )
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
    }
  })

  app.get('/api/lorebooks/summary', async (_request, reply) => {
    try {
      const lorebooks = await readLorebooksIndexSummary()
      return { lorebooks }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
    }
  })

  app.put('/api/lorebooks', async (request, reply) => {
    const contentLength = Number(request.headers['content-length'])
    if (
      Number.isFinite(contentLength) &&
      contentLength > LOREBOOKS_BULK_PUT_MAX_JSON_BYTES
    ) {
      return reply.status(413).send({
        error: ApiErrorCodes.lorebooks_bulk_put_payload_too_large,
      })
    }
    if (!tryAcquireLorebooksBulkPutSlot(getCurrentUserId())) {
      return reply.status(429).send({
        error: ApiErrorCodes.lorebooks_bulk_put_rate_limited,
      })
    }
    let validated: { lorebooks: LorebooksDocument['lorebooks'] }
    try {
      validated = assertValidLorebooksPayload(request.body)
    } catch (e) {
      return reply.status(400).send({
        error: ApiErrorCodes.lorebooks_validation_failed,
      })
    }
    const savedAt = new Date().toISOString()
    const doc: LorebooksDocument = {
      schemaVersion: 1,
      savedAt,
      lorebooks: validated.lorebooks,
    }
    try {
      await writeLorebooksDocument(doc)
      scheduleLorebookVectorReindex(validated.lorebooks)
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.lorebooks_write_failed })
    }
    return { ok: true as const, savedAt }
  })

  app.post('/api/lorebooks/import-st/preview', async (request, reply) => {
    const ct = request.headers['content-type'] ?? ''
    let source: unknown
    if (ct.includes('multipart/form-data')) {
      const file = await request.file()
      if (!file) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_file_field })
      }
      const buf = await file.toBuffer()
      if (!buf.length) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_file_field })
      }
      try {
        source = JSON.parse(buf.toString('utf8')) as unknown
      } catch {
        return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
      }
    } else {
      const body = request.body
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
      }
      const raw = body as { source?: unknown }
      source = raw.source != null ? raw.source : body
    }
    if (!isStLorebookJson(source)) {
      return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
    }
    try {
      const preview = previewStLorebookImport(source)
      if (preview.entryCount > ST_LOREBOOK_IMPORT_MAX_ENTRIES) {
        return reply.status(400).send({
          error: ApiErrorCodes.st_lorebook_too_many_entries,
        })
      }
      return preview
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.st_lorebook_import_failed })
    }
  })

  app.post('/api/lorebooks/import-st', async (request, reply) => {
    const body = request.body
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
    }
    const raw = body as { source?: unknown; name?: unknown }
    const source = raw.source != null ? raw.source : body
    if (!isStLorebookJson(source)) {
      return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
    }
    const name = typeof raw.name === 'string' ? raw.name.trim() : undefined
    try {
      const lorebook = await convertStLorebookToLorebook(source, { name })
      await writeLorebook(lorebook)
      scheduleLorebookVectorReindex([lorebook])
      return { ok: true as const, id: lorebook.id, name: lorebook.name }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.st_lorebook_import_failed })
    }
  })

  app.get<{ Params: { id: string } }>(
    '/api/lorebooks/:id',
    async (request, reply) => {
      const id = request.params.id
      if (!LOREBOOK_ID_RE.test(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      try {
        const lb = await readLorebookById(id)
        if (!lb) return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
        return lb
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
      }
    },
  )
}
