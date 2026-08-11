import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from '../api-error-codes.js'
import { isValidShortId } from '../short-id.js'
import { buildStV2CharacterExport, isPngBuffer } from '../character-png.js'
import { buildCharacterExportFilename, cardFromNewCharacterForm, contentDispositionAttachment, deleteCharacterFile, importCharacterCard, importCharacterCardPng, importCharacterCardWithPortrait, listCharacterSummaries, normalizeImportCard, parseCharacterListKind, parseCharacterListSort, parseCharacterListSortOrder, parseIsUserFromBody, patchCharacterDocument, readCharacterDocument, readCharacterDocumentForApi, readCharacterPngBuffer, getCharacterImageFiles, putCharacterImageFiles, updateCharacterPortrait } from '../character-storage.js'
import { portraitImageCacheControl, resolvePortraitImageResponse } from '../portrait-image.js'
import { fileMediaCacheControl, resolveFileLibraryMediaResponse } from '../file-library-media.js'
import { decodeFileMediaToken } from '../shared/file-media-token.js'

export function registerCharactersRoutes(app: FastifyInstance): void {
  app.get('/api/characters', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>
    const offset = Math.max(0, parseInt(q.offset ?? '0', 10) || 0)
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '24', 10) || 24))
    const search = typeof q.search === 'string' ? q.search : ''
    const rawF = q.filter
    const filter =
      rawF === 'used' || rawF === 'unused' ? rawF : ('all' as const)
    const sort = parseCharacterListSort(q.sort)
    const order = parseCharacterListSortOrder(q.order)
    const kind = parseCharacterListKind(q.kind)
    try {
      const { items, total, filterCounts } = await listCharacterSummaries({
        offset,
        limit,
        search,
        filter,
        kind,
        sort,
        order,
      })
      const hasMore = offset + items.length < total
      return { items, total, filterCounts, offset, limit, hasMore }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.characters_read_failed })
    }
  })

  app.post('/api/characters/import', async (request, reply) => {
    try {
      const card = normalizeImportCard(request.body)
      const doc = await importCharacterCard(card)
      return { ok: true as const, id: doc.id }
    } catch (e) {
      return reply.status(400).send({
        error: ApiErrorCodes.character_import_failed,
      })
    }
  })

  app.post('/api/characters/import-png', async (request, reply) => {
    try {
      const file = await request.file()
      if (!file) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_file_field })
      }
      const buf = await file.toBuffer()
      const doc = await importCharacterCardPng(buf)
      return { ok: true as const, id: doc.id }
    } catch (e) {
      return reply.status(400).send({
        error: ApiErrorCodes.character_import_png_failed,
      })
    }
  })

  app.post('/api/characters', async (request, reply) => {
    const ct = request.headers['content-type'] ?? ''
    if (ct.includes('multipart/form-data')) {
      try {
        let portraitBuf: Buffer | undefined
        let payload = ''
        const parts = request.parts()
        for await (const part of parts) {
          if (part.fieldname === 'portrait' && 'toBuffer' in part) {
            portraitBuf = await part.toBuffer()
          } else if (part.fieldname === 'payload') {
            const v = (part as { value?: unknown }).value
            payload = typeof v === 'string' ? v : ''
          }
        }
        if (!payload.trim()) {
          return reply.status(400).send({ error: ApiErrorCodes.multipart_payload_required })
        }
        let body: unknown
        try {
          body = JSON.parse(payload) as unknown
        } catch {
          return reply.status(400).send({ error: ApiErrorCodes.payload_invalid_json })
        }
        const card = cardFromNewCharacterForm(body)
        const isUser = parseIsUserFromBody(body)
        const doc = await importCharacterCardWithPortrait(card, portraitBuf, {
          isUser: isUser === true,
        })
        return { ok: true as const, id: doc.id }
      } catch (e) {
        return reply.status(400).send({
          error: ApiErrorCodes.character_create_failed,
        })
      }
    }
    try {
      const card = cardFromNewCharacterForm(request.body)
      const isUser = parseIsUserFromBody(request.body)
      const doc = await importCharacterCardWithPortrait(card, null, {
        isUser: isUser === true,
      })
      return { ok: true as const, id: doc.id }
    } catch (e) {
      return reply.status(400).send({
        error: ApiErrorCodes.character_create_failed,
      })
    }
  })

  app.get<{
    Params: { token: string }
    Querystring: { size?: string; v?: string }
  }>(
    '/api/i/:token',
    async (request, reply) => {
      const result = await resolvePortraitImageResponse(
        request.params.token,
        request.query.size,
      )
      if (!result.ok) {
        if (result.reason === 'invalid_size') {
          return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
        }
        return reply.status(404).send({
          error: ApiErrorCodes.character_not_found_or_no_png,
        })
      }
      const ifNoneMatch = request.headers['if-none-match']
      if (ifNoneMatch === result.etag) {
        return reply.status(304).send()
      }
      return reply
        .header('Content-Type', 'image/png')
        .header('Cache-Control', portraitImageCacheControl(request.query.size))
        .header('ETag', result.etag)
        .send(result.body)
    },
  )

  app.get<{
    Params: { token: string }
    Querystring: { size?: string; v?: string }
  }>(
    '/api/m/:token',
    async (request, reply) => {
      const ref = decodeFileMediaToken(request.params.token)
      if (!ref) {
        return reply.status(404).send({ error: ApiErrorCodes.file_not_found })
      }
      const result = await resolveFileLibraryMediaResponse(
        ref.userId,
        ref.fileId,
        request.query.size,
      )
      if (!result.ok) {
        if (result.reason === 'invalid_size') {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.invalid_request_body })
        }
        return reply.status(404).send({ error: ApiErrorCodes.file_not_found })
      }
      const ifNoneMatch = request.headers['if-none-match']
      if (ifNoneMatch === result.etag) {
        return reply.status(304).send()
      }
      if (result.mode === 'buffer') {
        return reply
          .header('Content-Type', result.mime)
          .header('Cache-Control', fileMediaCacheControl(request.query.size))
          .header('ETag', result.etag)
          .send(result.body)
      }
      const stream = result.stream
      stream.on('error', (err) => {
        request.log.error({ err }, 'file library media stream error')
        if (!reply.sent) {
          void reply.status(500).send({ error: ApiErrorCodes.files_read_failed })
        } else {
          reply.raw.destroy(err)
        }
      })
      return reply
        .header('Content-Type', result.mime)
        .header('Content-Length', String(result.size))
        .header(
          'Content-Disposition',
          `inline; filename*=UTF-8''${encodeURIComponent(result.name)}`,
        )
        .header('Cache-Control', fileMediaCacheControl(undefined))
        .header('ETag', result.etag)
        .send(stream)
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/characters/:id/export-png',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidShortId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const doc = await readCharacterDocument(id)
      if (!doc) {
        return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
      }
      const buf = await readCharacterPngBuffer(id)
      if (!buf) {
        return reply.status(404).send({ error: ApiErrorCodes.character_not_found_or_no_png })
      }
      const filename = buildCharacterExportFilename(doc.card, id, 'png')
      return reply
        .header('Content-Type', 'image/png')
        .header('Content-Disposition', contentDispositionAttachment(filename))
        .header('Cache-Control', 'private, no-store')
        .send(buf)
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/characters/:id/export-json',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidShortId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const doc = await readCharacterDocument(id)
      if (!doc) {
        return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
      }
      const payload = buildStV2CharacterExport(doc.card)
      const filename = buildCharacterExportFilename(doc.card, id, 'json')
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', contentDispositionAttachment(filename))
        .header('Cache-Control', 'private, no-store')
        .send(JSON.stringify(payload, null, 2))
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/characters/:id/portrait',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidShortId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      try {
        const file = await request.file()
        if (!file) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.missing_portrait_field })
        }
        const buf = await file.toBuffer()
        if (!isPngBuffer(buf)) {
          return reply.status(400).send({ error: ApiErrorCodes.png_image_required })
        }
        const updated = await updateCharacterPortrait(id, buf)
        if (!updated) return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
        const doc = await readCharacterDocumentForApi(id)
        if (!doc) return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
        return doc
      } catch (e) {
        app.log.error(e)
        return reply.status(400).send({
          error: ApiErrorCodes.portrait_upload_failed,
        })
      }
    },
  )

  app.patch<{ Params: { id: string }; Body: { card?: unknown; isUser?: unknown } }>(
    '/api/characters/:id',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidShortId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const body = request.body as { card?: unknown; isUser?: unknown }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes.card_body_invalid })
      }
      const hasCard =
        body.card &&
        typeof body.card === 'object' &&
        !Array.isArray(body.card)
      const isUser =
        typeof body.isUser === 'boolean' ? body.isUser : undefined
      if (!hasCard && typeof isUser !== 'boolean') {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes.card_body_invalid })
      }
      try {
        const doc = await patchCharacterDocument(id, {
          ...(hasCard
            ? { card: body.card as Record<string, unknown> }
            : {}),
          ...(typeof isUser === 'boolean' ? { isUser } : {}),
        })
        if (!doc) return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
        return doc
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.character_update_failed })
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/characters/:id/image-files',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidShortId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const data = await getCharacterImageFiles(id)
      if (!data) {
        return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
      }
      return data
    },
  )

  app.put<{ Params: { id: string }; Body: { fileIds?: unknown } }>(
    '/api/characters/:id/image-files',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidShortId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const body = request.body
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes.image_files_body_invalid })
      }
      const result = await putCharacterImageFiles(
        id,
        (body as { fileIds?: unknown }).fileIds,
      )
      if (!result.ok) {
        const status = result.error === 'character_not_found' ? 404 : 400
        return reply.status(status).send({
          error: ApiErrorCodes[result.error],
          ...(result.detail ? { detail: result.detail } : {}),
        })
      }
      return result.data
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/characters/:id',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidShortId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const doc = await readCharacterDocumentForApi(id)
      if (!doc) return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
      return doc
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/characters/:id',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidShortId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const ok = await deleteCharacterFile(id)
      if (!ok) return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
      return { ok: true as const }
    },
  )
}
