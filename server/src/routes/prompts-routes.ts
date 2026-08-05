import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from '../api-error-codes.js'
import { assertValidPromptPresetBody, assertValidPromptsPayload, deletePromptPreset, isValidPromptPresetId, patchPromptsIndex, readPromptPresetById, readPromptsDocument, readPromptsIndexDocument, writePromptPreset, writePromptsDocument, type PromptsDocument } from '../prompts-file.js'
import { normalizePresetForAssemble } from '../prompt-preset-normalize.js'
import type { PromptPreset } from '../assemble-prompts.js'
import { isPromptsSeedPut } from '../prompts-default-seed.js'
import { runPromptsAssemblePreview, type PromptsAssemblePreviewBody } from '../prompts-assemble-preview.js'
import { isStOpenAiPreset } from '../st-preset-detect.js'
import { convertStPresetToArousalPub } from '../st-preset-import.js'
import { StPresetValidationError } from '../st-preset-limits.js'

export function registerPromptsRoutes(app: FastifyInstance): void {
  app.get('/api/prompts', async (_request, reply) => {
    try {
      const data = await readPromptsIndexDocument()
      return data ?? null
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.prompts_read_failed })
    }
  })

  app.get<{ Params: { presetId: string } }>(
    '/api/prompts/:presetId',
    async (request, reply) => {
      const presetId = request.params.presetId?.trim() ?? ''
      if (!isValidPromptPresetId(presetId)) {
        return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
      }
      try {
        const preset = await readPromptPresetById(presetId)
        if (!preset) {
          return reply.status(404).send({ error: ApiErrorCodes.prompts_preset_not_found })
        }
        return normalizePresetForAssemble(preset as PromptPreset)
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.prompts_read_failed })
      }
    },
  )

  app.put<{ Params: { presetId: string } }>(
    '/api/prompts/:presetId',
    async (request, reply) => {
      const presetId = request.params.presetId?.trim() ?? ''
      if (!isValidPromptPresetId(presetId)) {
        return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
      }
      let body: Record<string, unknown>
      try {
        body = assertValidPromptPresetBody(request.body)
      } catch {
        return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
      }
      if (body.id !== presetId) {
        return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
      }
      try {
        const savedAt = await writePromptPreset(body)
        return { ok: true as const, savedAt }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.prompts_write_failed })
      }
    },
  )

  app.patch('/api/prompts', async (request, reply) => {
    const b = request.body
    if (!b || typeof b !== 'object') {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
    }
    const raw = b as {
      activePresetId?: unknown
      presets?: unknown
    }
    const patch: {
      activePresetId?: string
      presets?: { id: string; name: string; updatedAt: string }[]
    } = {}
    if (Object.prototype.hasOwnProperty.call(raw, 'activePresetId')) {
      if (typeof raw.activePresetId !== 'string' || !raw.activePresetId) {
        return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
      }
      if (!isValidPromptPresetId(raw.activePresetId)) {
        return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
      }
      patch.activePresetId = raw.activePresetId
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'presets')) {
      if (!Array.isArray(raw.presets)) {
        return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
      }
      const presets: { id: string; name: string; updatedAt: string }[] = []
      for (const item of raw.presets) {
        if (!item || typeof item !== 'object') {
          return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
        }
        const o = item as { id?: unknown; name?: unknown; updatedAt?: unknown }
        if (typeof o.id !== 'string' || !isValidPromptPresetId(o.id)) {
          return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
        }
        presets.push({
          id: o.id,
          name: typeof o.name === 'string' ? o.name : '',
          updatedAt:
            typeof o.updatedAt === 'string'
              ? o.updatedAt
              : new Date().toISOString(),
        })
      }
      patch.presets = presets
    }
    if (patch.activePresetId === undefined && patch.presets === undefined) {
      return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
    }
    try {
      const savedAt = await patchPromptsIndex(patch)
      return { ok: true as const, savedAt }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.prompts_write_failed })
    }
  })

  app.delete<{ Params: { presetId: string } }>(
    '/api/prompts/:presetId',
    async (request, reply) => {
      const presetId = request.params.presetId?.trim() ?? ''
      if (!isValidPromptPresetId(presetId)) {
        return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
      }
      try {
        await deletePromptPreset(presetId)
        return { ok: true as const }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('至少保留')) {
          return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
        }
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.prompts_write_failed })
      }
    },
  )

  app.put('/api/prompts', async (request, reply) => {
    let validated: { activePresetId: string; presets: unknown[] }
    try {
      validated = assertValidPromptsPayload(request.body)
    } catch (e) {
      return reply.status(400).send({
        error: ApiErrorCodes.prompts_validation_failed,
      })
    }
    if (isPromptsSeedPut(validated)) {
      return reply.status(400).send({
        error: ApiErrorCodes.prompts_seed_put_rejected,
      })
    }
    const savedAt = new Date().toISOString()
    const doc: PromptsDocument = {
      version: 3,
      savedAt,
      activePresetId: validated.activePresetId,
      presets: validated.presets,
    }
    try {
      await writePromptsDocument(doc)
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.prompts_write_failed })
    }
    return { ok: true as const, savedAt }
  })

  app.post<{ Body: PromptsAssemblePreviewBody }>(
    '/api/prompts/assemble-preview',
    async (request, reply) => {
      try {
        const doc = await readPromptsDocument()
        if (!doc) {
          return reply.status(500).send({ error: ApiErrorCodes.prompts_unavailable })
        }
        const result = runPromptsAssemblePreview(doc, request.body ?? {})
        if ('error' in result) {
          return reply.status(400).send({ error: result.error })
        }
        return result
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.prompts_preview_failed })
      }
    },
  )

  app.post('/api/prompts/convert-st', async (request, reply) => {
    const body = request.body
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
    }
    const raw = body as {
      source?: unknown
      presetName?: unknown
      characterOrderId?: unknown
      prompts?: unknown
      prompt_order?: unknown
    }
    const stSource =
      raw.source != null && isStOpenAiPreset(raw.source) ? raw.source : body
    if (!isStOpenAiPreset(stSource)) {
      return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
    }
    try {
      const characterOrderId =
        typeof raw.characterOrderId === 'number' &&
        Number.isFinite(raw.characterOrderId)
          ? raw.characterOrderId
          : undefined
      const presetName =
        typeof raw.presetName === 'string' ? raw.presetName.trim() : undefined
      const preset = convertStPresetToArousalPub(stSource, {
        characterOrderId,
        presetName,
      })
      assertValidPromptPresetBody(preset)
      return { preset }
    } catch (e) {
      if (
        e instanceof StPresetValidationError ||
        (e instanceof Error &&
          e.message.includes('ST preset missing prompt_order'))
      ) {
        return reply.status(400).send({
          error: ApiErrorCodes.prompts_validation_failed,
        })
      }
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.prompts_st_convert_failed })
    }
  })
}
