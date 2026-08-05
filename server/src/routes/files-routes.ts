import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from '../api-error-codes.js'
import { isValidShortId } from '../short-id.js'
import { createFileLibraryEntry, FileLibraryError, getFileLibraryMeta, listFileLibrary, patchFileLibraryMeta, replaceFileLibraryContent, resolveFileLibraryContent, type FileLibraryKind } from '../file-library-storage.js'
import { deleteFileLibraryEntryWithReferenceCheck, FileLibraryInUseError, findFileLibraryReferences } from '../file-library-references.js'
import { fileContentUrl } from '../file-content-url.js'
import { createReadStream } from 'node:fs'

function parseFileLibraryKindQuery(
  raw: string | undefined,
): FileLibraryKind | 'all' {
  if (
    raw === 'image' ||
    raw === 'document' ||
    raw === 'audio' ||
    raw === 'video'
  ) {
    return raw
  }
  return 'all'
}

function parseTagsField(raw: unknown): unknown {
  if (raw == null || raw === '') return undefined
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return undefined
    try {
      return JSON.parse(t) as unknown
    } catch {
      return t.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    }
  }
  return raw
}

export function registerFilesRoutes(app: FastifyInstance): void {
  app.get('/api/files', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>
    const offset = Math.max(0, parseInt(q.offset ?? '0', 10) || 0)
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '24', 10) || 24))
    const search = typeof q.search === 'string' ? q.search : ''
    const kind = parseFileLibraryKindQuery(q.kind)
    try {
      const { items, total } = await listFileLibrary({
        offset,
        limit,
        search,
        kind,
      })
      const hasMore = offset + items.length < total
      return { items, total, offset, limit, hasMore }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.files_read_failed })
    }
  })

  app.post('/api/files', async (request, reply) => {
    try {
      const ct = request.headers['content-type'] ?? ''
      if (!ct.includes('multipart/form-data')) {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes.multipart_payload_required })
      }
      let fileBuf: Buffer | undefined
      let filename: string | undefined
      let mime: string | undefined
      let kindField: string | undefined
      let nameField: string | undefined
      let fileIdField: string | undefined
      let tagsField: unknown
      const parts = request.parts()
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          fileBuf = await part.toBuffer()
          filename = part.filename
          mime = part.mimetype
        } else if (part.type === 'field') {
          const v = part.value
          if (part.fieldname === 'kind' && typeof v === 'string') kindField = v
          else if (part.fieldname === 'name' && typeof v === 'string') nameField = v
          else if (part.fieldname === 'fileId' && typeof v === 'string') {
            fileIdField = v
          } else if (part.fieldname === 'tags') tagsField = v
        }
      }
      if (!fileBuf) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_file_field })
      }
      try {
        const meta = await createFileLibraryEntry({
          buffer: fileBuf,
          filename,
          mime,
          kind: kindField,
          name: nameField,
          tags: parseTagsField(tagsField),
          fileId: fileIdField,
        })
        return {
          ok: true as const,
          ...meta,
          contentUrl: fileContentUrl(meta.fileId),
        }
      } catch (e) {
        if (e instanceof FileLibraryError) {
          if (e.code === 'file_id_taken') {
            return reply.status(409).send({ error: ApiErrorCodes.file_id_taken })
          }
          return reply.status(400).send({ error: ApiErrorCodes[e.code] ?? e.code })
        }
        throw e
      }
    } catch (e) {
      if (e instanceof FileLibraryError) {
        return reply.status(400).send({ error: ApiErrorCodes[e.code] ?? e.code })
      }
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.file_create_failed })
    }
  })

  app.get<{ Params: { fileId: string } }>(
    '/api/files/:fileId',
    async (request, reply) => {
      const fileId = request.params.fileId
      if (!isValidShortId(fileId)) {
        return reply.status(400).send({ error: ApiErrorCodes.file_invalid_id })
      }
      try {
        const meta = await getFileLibraryMeta(fileId)
        if (!meta) {
          return reply.status(404).send({ error: ApiErrorCodes.file_not_found })
        }
        return { ...meta, contentUrl: fileContentUrl(meta.fileId) }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.files_read_failed })
      }
    },
  )

  app.get<{ Params: { fileId: string } }>(
    '/api/files/:fileId/content',
    async (request, reply) => {
      const fileId = request.params.fileId
      if (!isValidShortId(fileId)) {
        return reply.status(400).send({ error: ApiErrorCodes.file_invalid_id })
      }
      try {
        const resolved = await resolveFileLibraryContent(fileId)
        if (!resolved) {
          return reply.status(404).send({ error: ApiErrorCodes.file_not_found })
        }
        const { contentPath, meta, byteSize } = resolved
        const stream = createReadStream(contentPath)
        stream.on('error', (err) => {
          request.log.error({ err }, 'file library content stream error')
          if (!reply.sent) {
            void reply.status(500).send({ error: ApiErrorCodes.files_read_failed })
          } else {
            reply.raw.destroy(err)
          }
        })
        return reply
          .header('Content-Length', String(byteSize))
          .header(
            'Content-Disposition',
            `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
          )
          .type(meta.mime)
          .send(stream)
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.files_read_failed })
      }
    },
  )

  /** 原地更新二进制：fileId / 公开 URL 不变；文件名可不同 */
  app.put<{ Params: { fileId: string } }>(
    '/api/files/:fileId/content',
    async (request, reply) => {
      const fileId = request.params.fileId
      if (!isValidShortId(fileId)) {
        return reply.status(400).send({ error: ApiErrorCodes.file_invalid_id })
      }
      try {
        const ct = request.headers['content-type'] ?? ''
        if (!ct.includes('multipart/form-data')) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.multipart_payload_required })
        }
        let fileBuf: Buffer | undefined
        let filename: string | undefined
        let mime: string | undefined
        let nameField: string | undefined
        let keepName = false
        const parts = request.parts()
        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'file') {
            fileBuf = await part.toBuffer()
            filename = part.filename
            mime = part.mimetype
          } else if (part.type === 'field') {
            const v = part.value
            if (part.fieldname === 'name' && typeof v === 'string') nameField = v
            else if (
              part.fieldname === 'keepName' &&
              (v === '1' || v === 'true' || v === true)
            ) {
              keepName = true
            }
          }
        }
        if (!fileBuf) {
          return reply.status(400).send({ error: ApiErrorCodes.missing_file_field })
        }
        const meta = await replaceFileLibraryContent(fileId, {
          buffer: fileBuf,
          filename,
          mime,
          name: nameField,
          keepName,
        })
        if (meta.kind === 'document') {
          const { findKnowledgeBasesContainingFile } = await import('../knowledge-base-file.js'
          )
          const { scheduleKnowledgeBasesReindex } = await import('../knowledge-vector-index.js'
          )
          const kbs = await findKnowledgeBasesContainingFile(meta.fileId)
          if (kbs.length) {
            scheduleKnowledgeBasesReindex(kbs.map((k) => k.id))
          }
        }
        return {
          ok: true as const,
          ...meta,
          contentUrl: fileContentUrl(meta.fileId),
        }
      } catch (e) {
        if (e instanceof FileLibraryError) {
          if (e.code === 'file_not_found') {
            return reply.status(404).send({ error: ApiErrorCodes.file_not_found })
          }
          return reply.status(400).send({ error: ApiErrorCodes[e.code] ?? e.code })
        }
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.file_update_failed })
      }
    },
  )

  app.patch<{ Params: { fileId: string } }>(
    '/api/files/:fileId',
    async (request, reply) => {
      const fileId = request.params.fileId
      if (!isValidShortId(fileId)) {
        return reply.status(400).send({ error: ApiErrorCodes.file_invalid_id })
      }
      const body = (request.body ?? {}) as Record<string, unknown>
      const hadName = typeof body.name === 'string'
      try {
        const prev = hadName ? await getFileLibraryMeta(fileId) : null
        const meta = await patchFileLibraryMeta(fileId, {
          name: body.name,
          tags: body.tags !== undefined ? body.tags : undefined,
        })
        if (
          hadName &&
          meta.kind === 'document' &&
          prev &&
          prev.name !== meta.name
        ) {
          const { findKnowledgeBasesContainingFile } = await import('../knowledge-base-file.js'
          )
          const { scheduleKnowledgeBasesReindex } = await import('../knowledge-vector-index.js'
          )
          const kbs = await findKnowledgeBasesContainingFile(meta.fileId)
          if (kbs.length) {
            scheduleKnowledgeBasesReindex(kbs.map((k) => k.id))
          }
        }
        return { ok: true as const, ...meta, contentUrl: fileContentUrl(meta.fileId) }
      } catch (e) {
        if (e instanceof FileLibraryError) {
          if (e.code === 'file_not_found') {
            return reply.status(404).send({ error: ApiErrorCodes.file_not_found })
          }
          return reply.status(400).send({ error: ApiErrorCodes[e.code] ?? e.code })
        }
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.file_update_failed })
      }
    },
  )

  app.get<{ Params: { fileId: string } }>(
    '/api/files/:fileId/references',
    async (request, reply) => {
      const fileId = request.params.fileId
      if (!isValidShortId(fileId)) {
        return reply.status(400).send({ error: ApiErrorCodes.file_invalid_id })
      }
      const references = await findFileLibraryReferences(fileId)
      const meta = await getFileLibraryMeta(fileId)
      // 文件已删但仍有悬空宿主引用时仍返回列表，便于排查 / 强制清理
      if (!meta && references.length === 0) {
        return reply.status(404).send({ error: ApiErrorCodes.file_not_found })
      }
      return {
        references,
        missing: !meta,
      }
    },
  )

  app.delete<{
    Params: { fileId: string }
    Querystring: { force?: string }
  }>(
    '/api/files/:fileId',
    async (request, reply) => {
      const fileId = request.params.fileId
      if (!isValidShortId(fileId)) {
        return reply.status(400).send({ error: ApiErrorCodes.file_invalid_id })
      }
      const forceRaw = request.query?.force
      const force =
        forceRaw === '1' ||
        forceRaw === 'true' ||
        forceRaw === 'yes'
      try {
        const ok = await deleteFileLibraryEntryWithReferenceCheck(fileId, { force })
        if (!ok) {
          return reply.status(404).send({ error: ApiErrorCodes.file_not_found })
        }
        return { ok: true as const }
      } catch (e) {
        if (e instanceof FileLibraryInUseError) {
          return reply.status(409).send({
            error: ApiErrorCodes.file_in_use,
            references: e.references,
          })
        }
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.file_delete_failed })
      }
    },
  )
}
