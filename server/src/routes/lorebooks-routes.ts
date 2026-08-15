import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from '../api-error-codes.js'
import { assertValidLorebooksPayload, LOREBOOKS_BULK_PUT_MAX_JSON_BYTES, readLorebookById, readLorebooksDocument, readLorebooksIndexSummary, writeLorebook, writeLorebooksDocument, LOREBOOK_ID_RE, type LorebooksDocument } from '../lorebook-file.js'
import { tryAcquireLorebooksBulkPutSlot } from '../lorebooks-bulk-put-limit.js'
import { getCurrentUserId } from '../user-context.js'
import { reindexLorebookFtsExclusive, reindexLorebooksVector, scheduleLorebookFtsReindex, scheduleLorebookVectorReindex } from '../lorebook-vector-index.js'
import { convertStLorebookToLorebook, isStLorebookJson, previewStLorebookImport, ST_LOREBOOK_IMPORT_MAX_ENTRIES } from '../st-lorebook-import.js'
import { parseHybridFtsSettingsStrict, type HybridFtsSettings } from '../hybrid-fts-settings.js'
import { resolveAssetHybridFtsSettings } from '../asset-hybrid-fts.js'
import { lorebookHybridFtsStatus } from '../asset-hybrid-fts-status.js'
import { formatHybridFtsSpec } from '../hybrid-fts-settings.js'
import { isHybridFtsDictNotReadyError } from '../hybrid-fts-dict-errors.js'
import type { Lorebook } from '../lorebook-types.js'

function lorebookVectorFingerprint(lorebook: Lorebook): string {
  return JSON.stringify(lorebook.entries)
}

async function withLorebookHybridFtsStatus(lorebook: Lorebook) {
  const status = await lorebookHybridFtsStatus(lorebook)
  return { ...lorebook, ...status }
}

export function registerLorebooksRoutes(app: FastifyInstance): void {
  app.get('/api/lorebooks', async (_request, reply) => {
    try {
      const data = await readLorebooksDocument()
      if (!data) {
        return {
          schemaVersion: 1,
          savedAt: '',
          lorebooks: [],
        }
      }
      return {
        ...data,
        lorebooks: await Promise.all(data.lorebooks.map(withLorebookHybridFtsStatus)),
      }
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
      const previous = await readLorebooksDocument()
      await writeLorebooksDocument(doc)
      const previousById = new Map(
        (previous?.lorebooks ?? []).map((lorebook) => [lorebook.id, lorebook]),
      )
      const full: Lorebook[] = []
      const ftsOnly: string[] = []
      for (const lorebook of validated.lorebooks) {
        const before = previousById.get(lorebook.id)
        if (
          !before ||
          lorebookVectorFingerprint(before) !== lorebookVectorFingerprint(lorebook)
        ) {
          full.push(lorebook)
          continue
        }
        const [beforeSettings, afterSettings] = await Promise.all([
          resolveAssetHybridFtsSettings(before.hybridFts),
          resolveAssetHybridFtsSettings(lorebook.hybridFts),
        ])
        if (
          formatHybridFtsSpec(beforeSettings) !==
          formatHybridFtsSpec(afterSettings)
        ) {
          ftsOnly.push(lorebook.id)
        }
      }
      scheduleLorebookVectorReindex(full)
      scheduleLorebookFtsReindex(ftsOnly)
    } catch (e) {
      app.log.error(e)
      if (isHybridFtsDictNotReadyError(e)) {
        return reply.status(409).send({
          error: ApiErrorCodes.hybrid_fts_dict_not_ready,
          detail: e instanceof Error ? e.message : String(e),
        })
      }
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
        return withLorebookHybridFtsStatus(lb)
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
      }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/lorebooks/:id',
    async (request, reply) => {
      const id = request.params.id
      if (!LOREBOOK_ID_RE.test(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const body = request.body
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply.status(400).send({ error: ApiErrorCodes.lorebooks_validation_failed })
      }
      const raw = body as Record<string, unknown>
      const allowed = new Set([
        'name',
        'description',
        'groups',
        'entries',
        'hybridFts',
      ])
      if (
        Object.keys(raw).length === 0 ||
        Object.keys(raw).some((key) => !allowed.has(key))
      ) {
        return reply.status(400).send({ error: ApiErrorCodes.lorebooks_validation_failed })
      }
      let hybridFts: HybridFtsSettings | null | undefined
      if (Object.prototype.hasOwnProperty.call(raw, 'hybridFts')) {
        if (raw.hybridFts === null) hybridFts = null
        else {
          hybridFts = parseHybridFtsSettingsStrict(raw.hybridFts)
          if (!hybridFts) {
            return reply.status(400).send({ error: ApiErrorCodes.hybrid_fts_settings_invalid })
          }
        }
      }
      try {
        const current = await readLorebookById(id)
        if (!current) {
          return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
        }
        const next: Lorebook = {
          ...current,
          updatedAt: new Date().toISOString(),
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'name')) {
          if (typeof raw.name !== 'string' || !raw.name.trim()) {
            return reply.status(400).send({ error: ApiErrorCodes.lorebooks_validation_failed })
          }
          next.name = raw.name.trim()
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'description')) {
          if (raw.description !== null && typeof raw.description !== 'string') {
            return reply.status(400).send({ error: ApiErrorCodes.lorebooks_validation_failed })
          }
          if (typeof raw.description === 'string' && raw.description.trim()) {
            next.description = raw.description.trim()
          } else {
            delete next.description
          }
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'groups')) {
          next.groups = raw.groups as Lorebook['groups']
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'entries')) {
          next.entries = raw.entries as Lorebook['entries']
        }
        if (hybridFts === null) delete next.hybridFts
        else if (hybridFts !== undefined) next.hybridFts = hybridFts

        await writeLorebook(next)
        const contentChanged =
          lorebookVectorFingerprint(current) !== lorebookVectorFingerprint(next)
        if (contentChanged) {
          scheduleLorebookVectorReindex([next])
        } else if (Object.prototype.hasOwnProperty.call(raw, 'hybridFts')) {
          // 资产「应用并重建」：只要写了 hybridFts 就等 FTS exclusive，
          // 即使 effective spec 未变也能清掉 stale / 修复半残索引。
          await reindexLorebookFtsExclusive(id)
        }
        return withLorebookHybridFtsStatus(next)
      } catch (e) {
        app.log.error(e)
        if (isHybridFtsDictNotReadyError(e)) {
          return reply.status(409).send({
            error: ApiErrorCodes.hybrid_fts_dict_not_ready,
            detail: e instanceof Error ? e.message : String(e),
          })
        }
        return reply.status(400).send({ error: ApiErrorCodes.lorebooks_validation_failed })
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/lorebooks/:id/reindex',
    async (request, reply) => {
      const id = request.params.id
      if (!LOREBOOK_ID_RE.test(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      try {
        const lorebook = await readLorebookById(id)
        if (!lorebook) {
          return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
        }
        await reindexLorebooksVector([lorebook])
        return { ok: true as const }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.reindex_failed })
      }
    },
  )
}
