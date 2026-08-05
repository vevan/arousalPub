import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from '../api-error-codes.js'
import { removeKnowledgeBaseIdFromAllConversations } from '../chat-storage.js'
import { startKnowledgeBaseReindexSse } from '../knowledge-reindex-sse.js'
import { createKnowledgeBase, listKnowledgeBases, patchKnowledgeBase, readKnowledgeBaseById, readKnowledgeBasesIndexSummary } from '../knowledge-base-file.js'
import { deleteKnowledgeBaseWithExclusiveLock, reindexKnowledgeBaseExclusive, scheduleKnowledgeBaseReindex } from '../knowledge-vector-index.js'

const KNOWLEDGE_BASE_CLIENT_ERROR_CODES = new Set([
  'name_required',
  'invalid_id',
  'kb_id_taken',
  'file_not_found',
  'file_not_document',
])

function knowledgeBaseClientErrorCode(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null
  const code = (e as { code?: unknown }).code
  if (typeof code !== 'string') return null
  return KNOWLEDGE_BASE_CLIENT_ERROR_CODES.has(code) ? code : null
}

export function registerKnowledgeRoutes(app: FastifyInstance): void {
  app.get('/api/knowledge-bases', async (_request, reply) => {
    try {
      const knowledgeBases = await listKnowledgeBases()
      return { knowledgeBases }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.knowledge_bases_read_failed })
    }
  })

  app.get('/api/knowledge-bases/summary', async (_request, reply) => {
    try {
      const data = await readKnowledgeBasesIndexSummary()
      return data
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.knowledge_bases_read_failed })
    }
  })

  app.post('/api/knowledge-bases', async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: unknown
      description?: unknown
      fileIds?: unknown
      id?: unknown
    }
    if (typeof body.name !== 'string') {
      return reply.status(400).send({ error: ApiErrorCodes.name_required })
    }
    if (
      body.fileIds !== undefined &&
      (!Array.isArray(body.fileIds) ||
        !body.fileIds.every((x) => typeof x === 'string'))
    ) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
    }
    if (
      body.id !== undefined &&
      body.id !== null &&
      typeof body.id !== 'string'
    ) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    if (
      body.description !== undefined &&
      body.description !== null &&
      typeof body.description !== 'string'
    ) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
    }
    try {
      const kb = await createKnowledgeBase({
        name: body.name,
        description:
          typeof body.description === 'string' ? body.description : undefined,
        fileIds: Array.isArray(body.fileIds)
          ? (body.fileIds as string[])
          : undefined,
        id: typeof body.id === 'string' ? body.id : undefined,
      })
      scheduleKnowledgeBaseReindex(kb.id)
      return kb
    } catch (e) {
      const code = knowledgeBaseClientErrorCode(e)
      if (code) {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes[code as keyof typeof ApiErrorCodes] ?? code })
      }
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.knowledge_bases_write_failed })
    }
  })

  app.get<{ Params: { id: string } }>(
    '/api/knowledge-bases/:id',
    async (request, reply) => {
      const id = request.params.id
      try {
        const kb = await readKnowledgeBaseById(id)
        if (!kb) {
          return reply.status(404).send({ error: ApiErrorCodes.knowledge_base_not_found })
        }
        return kb
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.knowledge_bases_read_failed })
      }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/knowledge-bases/:id',
    async (request, reply) => {
      const id = request.params.id
      const body = (request.body ?? {}) as Record<string, unknown>
      const patch: {
        name?: string
        description?: string | null
        fileIds?: string[]
        fileAliases?: Record<string, string>
      } = {}
      if (Object.prototype.hasOwnProperty.call(body, 'name')) {
        if (typeof body.name !== 'string') {
          return reply.status(400).send({ error: ApiErrorCodes.name_required })
        }
        patch.name = body.name
      }
      if (Object.prototype.hasOwnProperty.call(body, 'description')) {
        if (body.description !== null && typeof body.description !== 'string') {
          return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
        }
        patch.description = body.description as string | null
      }
      if (Object.prototype.hasOwnProperty.call(body, 'fileIds')) {
        if (
          !Array.isArray(body.fileIds) ||
          !body.fileIds.every((x) => typeof x === 'string')
        ) {
          return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
        }
        patch.fileIds = body.fileIds as string[]
      }
      if (Object.prototype.hasOwnProperty.call(body, 'fileAliases')) {
        const fa = body.fileAliases
        if (
          !fa ||
          typeof fa !== 'object' ||
          Array.isArray(fa) ||
          !Object.values(fa as Record<string, unknown>).every(
            (v) => typeof v === 'string',
          )
        ) {
          return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
        }
        patch.fileAliases = fa as Record<string, string>
      }
      if (
        patch.name === undefined &&
        patch.description === undefined &&
        patch.fileIds === undefined &&
        patch.fileAliases === undefined
      ) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
      }
      try {
        const prev =
          patch.fileIds !== undefined ? await readKnowledgeBaseById(id) : null
        const kb = await patchKnowledgeBase(id, patch)
        if (!kb) {
          return reply.status(404).send({ error: ApiErrorCodes.knowledge_base_not_found })
        }
        if (patch.fileIds !== undefined) {
          const prevIds = prev?.fileIds ?? []
          const changed =
            prevIds.length !== kb.fileIds.length ||
            prevIds.some((fid, i) => fid !== kb.fileIds[i])
          if (changed) scheduleKnowledgeBaseReindex(kb.id)
        }
        return kb
      } catch (e) {
        const code = knowledgeBaseClientErrorCode(e)
        if (code) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes[code as keyof typeof ApiErrorCodes] ?? code })
        }
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.knowledge_bases_write_failed })
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/knowledge-bases/:id',
    async (request, reply) => {
      const id = request.params.id
      try {
        const existing = await readKnowledgeBaseById(id)
        if (!existing) {
          return reply.status(404).send({ error: ApiErrorCodes.knowledge_base_not_found })
        }
        const deleted = await deleteKnowledgeBaseWithExclusiveLock(id)
        if (!deleted) {
          return reply.status(404).send({ error: ApiErrorCodes.knowledge_base_not_found })
        }
        await removeKnowledgeBaseIdFromAllConversations(id)
        return { ok: true as const }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.knowledge_bases_write_failed })
      }
    },
  )

  app.post<{ Params: { id: string }; Querystring: { stream?: string } }>(
    '/api/knowledge-bases/:id/reindex',
    async (request, reply) => {
      const id = request.params.id
      try {
        const existing = await readKnowledgeBaseById(id)
        if (!existing) {
          return reply.status(404).send({ error: ApiErrorCodes.knowledge_base_not_found })
        }
        const wantStream =
          request.query.stream === '1' || request.query.stream === 'true'
        if (wantStream) {
          const stream = startKnowledgeBaseReindexSse(
            id,
            reply,
            existing.fileIds.length,
          )
          return reply.send(stream)
        }
        const { chunkCount } = await reindexKnowledgeBaseExclusive(id)
        return { ok: true as const, chunkCount }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        app.log.error(e)
        return reply.status(500).send({
          error: ApiErrorCodes.reindex_failed,
          detail,
        })
      }
    },
  )
}
