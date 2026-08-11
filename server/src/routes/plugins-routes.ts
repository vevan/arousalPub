import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from '../api-error-codes.js'
import { CONVERSATION_BATCH_MAX_TURNS } from '../turn-patch-body.js'
import { isValidConversationId } from '../conversation-id.js'
import { readLorebookById, readLorebooksIndexSummary, LOREBOOK_ID_RE } from '../lorebook-file.js'
import { getCurrentUserId } from '../user-context.js'
import { listPublicPluginRegistry, listPluginsManage, readMergedPluginUserSettings, readPluginDistFile, readPluginLocaleFile, savePluginRegistry, writePluginUserSettings, invalidatePluginLoaderCache } from '../plugin-system/loader.js'
import { exportPluginUserSettingsPortable, importPluginUserSettingsPortable, PluginSettingsPortabilityError } from '../plugin-system/settings-portability.js'
import { readPluginBundledAsset, readPluginUserAsset, savePluginUserAssetUpload } from '../plugin-system/plugin-assets.js'
import { readPluginManifest } from '../plugin-system/manifest.js'
import { scheduleLorebookVectorReindex } from '../lorebook-vector-index.js'
import { createLorebookEntriesBatch, createLorebookEntry, patchLorebookEntry, LOREBOOK_ENTRY_ID_RE, type LorebookEntryCreateBody } from '../lorebook-entries.js'
import { resolvePluginCompleteApi } from '../plugin-api-resolve.js'
import { listPluginActionPermissions, mapPluginActionErrorStatus, runPluginActionRoute } from '../plugin-action-route.js'
import { runPluginComplete } from '../plugin-complete.js'
import { runPluginCompletePreflight } from '../plugin-complete-preflight.js'
import { runNormalizeLorebookEntryRefs } from '../plugin-lorebook-entry-refs.js'
import { runApplyLorebookOrder } from '../plugin-lorebook-apply-order.js'
import { ensurePluginLorebook } from '../plugin-lorebook-ensure.js'
import { runPluginMacroExpand } from '../plugin-macro-expand.js'
import { contextBlockSpecsNeedLorebookRead, parseContextBlockSpecs, runPluginContextBlocksResolve } from '../plugin-context-blocks-resolve.js'
import { parseAssemblePluginPromptBody, runAssemblePluginPrompt } from '../plugin-assemble-prompt.js'
import { parseCompleteWithContextBody, runCompleteWithContext } from '../plugin-complete-with-context.js'
import { assertPluginRoutePermission } from '../plugin-route-auth.js'

export function registerPluginsRoutes(app: FastifyInstance): void {
  app.get('/api/plugins/registry', async (request, reply) => {
    try {
      const plugins = await listPublicPluginRegistry()
      return { plugins }
    } catch (e) {
      app.log.error(e)
      return reply
        .status(500)
        .send({ error: ApiErrorCodes.plugin_registry_read_failed })
    }
  })

  app.get('/api/plugins/manage', async (_request, reply) => {
    const plugins = await listPluginsManage()
    return { plugins }
  })

  app.put<{ Body: { plugins?: Array<{ id: string; enabled?: boolean; order?: number }> } }>(
    '/api/plugins/registry',
    async (request, reply) => {
      const body = request.body ?? {}
      const raw = body.plugins
      if (!Array.isArray(raw)) {
        return reply.status(400).send({ error: 'invalid_body' })
      }
      try {
        const doc = await savePluginRegistry({
          version: 1,
          plugins: raw.map((p, i) => ({
            id: String(p.id ?? '').trim(),
            enabled: p.enabled !== false,
            order:
              typeof p.order === 'number' && Number.isFinite(p.order)
                ? Math.round(p.order)
                : (i + 1) * 10,
          })),
        })
        return { plugins: doc.plugins }
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (msg === 'invalid_plugin_id' || msg === 'plugin_registry_manifest_mismatch') {
          return reply.status(400).send({ error: ApiErrorCodes.plugin_registry_invalid })
        }
        throw e
      }
    },
  )

  app.get<{ Params: { pluginId: string } }>(
    '/api/plugins/:pluginId/settings',
    async (request, reply) => {
      const settings = await readMergedPluginUserSettings(request.params.pluginId)
      return { settings }
    },
  )

  app.put<{ Params: { pluginId: string }; Body: Record<string, unknown> }>(
    '/api/plugins/:pluginId/settings',
    async (request, reply) => {
      try {
        const settings = await writePluginUserSettings(
          request.params.pluginId,
          request.body ?? {},
        )
        return { settings }
      } catch (e) {
        if (
          e &&
          typeof e === 'object' &&
          'code' in e &&
          (e as { code: string }).code === 'plugin_settings_invalid'
        ) {
          return reply.status(400).send({ error: ApiErrorCodes.plugin_settings_invalid })
        }
        return reply.status(404).send({ error: 'not_found' })
      }
    },
  )

  app.get<{ Params: { pluginId: string } }>(
    '/api/plugins/:pluginId/settings/export',
    async (request, reply) => {
      try {
        return await exportPluginUserSettingsPortable(request.params.pluginId)
      } catch (e) {
        if (e instanceof PluginSettingsPortabilityError) {
          if (e.code === 'plugin_not_found') {
            return reply.status(404).send({ error: ApiErrorCodes.plugin_not_found })
          }
          if (e.code === 'invalid_plugin_id') {
            return reply.status(400).send({ error: ApiErrorCodes.invalid_plugin_id })
          }
          return reply.status(400).send({ error: e.code })
        }
        throw e
      }
    },
  )

  app.post<{ Params: { pluginId: string }; Body: unknown }>(
    '/api/plugins/:pluginId/settings/import',
    async (request, reply) => {
      try {
        const result = await importPluginUserSettingsPortable(
          request.params.pluginId,
          request.body ?? {},
        )
        invalidatePluginLoaderCache()
        return result
      } catch (e) {
        if (e instanceof PluginSettingsPortabilityError) {
          if (e.code === 'plugin_not_found') {
            return reply.status(404).send({ error: ApiErrorCodes.plugin_not_found })
          }
          if (e.code === 'invalid_plugin_id') {
            return reply.status(400).send({ error: ApiErrorCodes.invalid_plugin_id })
          }
          if (e.code === 'plugin_settings_plugin_mismatch') {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.plugin_settings_plugin_mismatch })
          }
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.plugin_settings_import_invalid })
        }
        if (
          e &&
          typeof e === 'object' &&
          'code' in e &&
          (e as { code: string }).code === 'plugin_settings_invalid'
        ) {
          return reply.status(400).send({ error: ApiErrorCodes.plugin_settings_invalid })
        }
        if (e instanceof Error && e.message === 'plugin_not_found') {
          return reply.status(404).send({ error: ApiErrorCodes.plugin_not_found })
        }
        throw e
      }
    },
  )

  app.get<{ Params: { pluginId: string } }>(
    '/api/plugins/:pluginId/lorebooks',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const auth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
      try {
        const lorebooks = await readLorebooksIndexSummary()
        return { lorebooks }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
      }
    },
  )

  app.post<{
    Params: { pluginId: string }
    Body: { conversationId?: string; nameTemplate?: string }
  }>(
    '/api/plugins/:pluginId/lorebooks/ensure',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const writeAuth = await assertPluginRoutePermission(pluginId, 'lorebook.write')
      if (!writeAuth.ok) {
        return reply.status(writeAuth.status).send({ error: ApiErrorCodes[writeAuth.code] })
      }
      const readAuth = await assertPluginRoutePermission(pluginId, 'conversation.read')
      if (!readAuth.ok) {
        return reply.status(readAuth.status).send({ error: ApiErrorCodes[readAuth.code] })
      }
      const body = request.body ?? {}
      const conversationId =
        typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
      if (!conversationId || !isValidConversationId(conversationId)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const nameTemplate =
        typeof body.nameTemplate === 'string' ? body.nameTemplate : undefined
      try {
        const result = await ensurePluginLorebook({ conversationId, nameTemplate })
        if (!result) {
          return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        }
        return {
          ok: true as const,
          id: result.id,
          name: result.name,
          created: result.created,
          lorebook: result.lorebook,
        }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.lorebooks_write_failed })
      }
    },
  )

  app.get<{ Params: { pluginId: string; lorebookId: string } }>(
    '/api/plugins/:pluginId/lorebooks/:lorebookId',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const lorebookId = request.params.lorebookId
      if (!LOREBOOK_ID_RE.test(lorebookId)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const auth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
      try {
        const lb = await readLorebookById(lorebookId)
        if (!lb) return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
        return lb
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
      }
    },
  )

  app.post<{
    Params: { pluginId: string; lorebookId: string }
    Body: Record<string, unknown>
  }>(
    '/api/plugins/:pluginId/lorebooks/:lorebookId/entries',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const lorebookId = request.params.lorebookId
      if (!LOREBOOK_ID_RE.test(lorebookId)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const auth = await assertPluginRoutePermission(pluginId, 'lorebook.entry.write')
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
      const body = request.body ?? {}
      try {
        const result = await createLorebookEntry(lorebookId, {
          groupId: typeof body.groupId === 'string' ? body.groupId : undefined,
          title: typeof body.title === 'string' ? body.title : '',
          content: typeof body.content === 'string' ? body.content : '',
          keys: Array.isArray(body.keys) ? (body.keys as string[]) : undefined,
          comment: typeof body.comment === 'string' ? body.comment : undefined,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
          constant: typeof body.constant === 'boolean' ? body.constant : undefined,
          triggerMode:
            body.triggerMode === 'keyword' ||
            body.triggerMode === 'constant' ||
            body.triggerMode === 'vector'
              ? body.triggerMode
              : undefined,
          priority:
            typeof body.priority === 'number' ? body.priority : undefined,
          order: typeof body.order === 'number' ? body.order : undefined,
        })
        if (!result) {
          return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
        }
        scheduleLorebookVectorReindex([result.lorebook])
        return { ok: true as const, entry: result.entry, savedAt: result.savedAt }
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        app.log.error(e)
        if (msg.includes('title')) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.lorebook_entry_validation_failed })
        }
        return reply.status(500).send({ error: ApiErrorCodes.lorebook_entry_create_failed })
      }
    },
  )

  app.post<{
    Params: { pluginId: string; lorebookId: string }
    Body: { entries?: unknown }
  }>(
    '/api/plugins/:pluginId/lorebooks/:lorebookId/entries/batch',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const lorebookId = request.params.lorebookId
      if (!LOREBOOK_ID_RE.test(lorebookId)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const auth = await assertPluginRoutePermission(pluginId, 'lorebook.entry.write')
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
      const raw = request.body?.entries
      if (!Array.isArray(raw) || raw.length === 0) {
        return reply.status(400).send({ error: ApiErrorCodes.lorebook_entry_validation_failed })
      }
      if (raw.length > CONVERSATION_BATCH_MAX_TURNS) {
        return reply.status(400).send({ error: ApiErrorCodes.range_too_large })
      }
      const bodies: LorebookEntryCreateBody[] = raw.map((item) => {
        const body = (item ?? {}) as Record<string, unknown>
        return {
          groupId: typeof body.groupId === 'string' ? body.groupId : undefined,
          title: typeof body.title === 'string' ? body.title : '',
          content: typeof body.content === 'string' ? body.content : '',
          keys: Array.isArray(body.keys) ? (body.keys as string[]) : undefined,
          comment: typeof body.comment === 'string' ? body.comment : undefined,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
          constant: typeof body.constant === 'boolean' ? body.constant : undefined,
          triggerMode:
            body.triggerMode === 'keyword' ||
            body.triggerMode === 'constant' ||
            body.triggerMode === 'vector'
              ? body.triggerMode
              : undefined,
          priority:
            typeof body.priority === 'number' ? body.priority : undefined,
          order: typeof body.order === 'number' ? body.order : undefined,
        }
      })
      try {
        const result = await createLorebookEntriesBatch(lorebookId, bodies)
        if (!result) {
          return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
        }
        scheduleLorebookVectorReindex([result.lorebook])
        return {
          ok: true as const,
          entries: result.entries,
          savedAt: result.savedAt,
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        app.log.error(e)
        if (msg.includes('title')) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.lorebook_entry_validation_failed })
        }
        return reply.status(500).send({ error: ApiErrorCodes.lorebook_entry_create_failed })
      }
    },
  )

  app.patch<{
    Params: { pluginId: string; lorebookId: string; entryId: string }
    Body: Record<string, unknown>
  }>(
    '/api/plugins/:pluginId/lorebooks/:lorebookId/entries/:entryId',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const lorebookId = request.params.lorebookId
      const entryId = request.params.entryId
      if (!LOREBOOK_ID_RE.test(lorebookId)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      if (!LOREBOOK_ENTRY_ID_RE.test(entryId)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const auth = await assertPluginRoutePermission(pluginId, 'lorebook.entry.write')
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
      const body = request.body ?? {}
      try {
        const result = await patchLorebookEntry(lorebookId, entryId, {
          title: typeof body.title === 'string' ? body.title : undefined,
          content: typeof body.content === 'string' ? body.content : undefined,
          keys: Array.isArray(body.keys) ? (body.keys as string[]) : undefined,
          comment: typeof body.comment === 'string' ? body.comment : undefined,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
          constant: typeof body.constant === 'boolean' ? body.constant : undefined,
          triggerMode:
            body.triggerMode === 'keyword' ||
            body.triggerMode === 'constant' ||
            body.triggerMode === 'vector'
              ? body.triggerMode
              : undefined,
          priority:
            typeof body.priority === 'number' ? body.priority : undefined,
          order: typeof body.order === 'number' ? body.order : undefined,
          groupId: typeof body.groupId === 'string' ? body.groupId : undefined,
        })
        if (!result) {
          return reply.status(404).send({ error: ApiErrorCodes.lorebook_entry_not_found })
        }
        scheduleLorebookVectorReindex([result.lorebook])
        return { ok: true as const, entry: result.entry, savedAt: result.savedAt }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.lorebook_entry_patch_failed })
      }
    },
  )

  app.post<{
    Params: { pluginId: string }
    Body: {
      conversationId?: string
      apiConfigId?: string
      messages?: { role: string; content: string }[]
      modelOverride?: string
      stream?: boolean
      responseFormat?: string
    }
  }>(
    '/api/plugins/:pluginId/complete',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const auth = await assertPluginRoutePermission(pluginId, 'plugin.complete')
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
      const body = request.body ?? {}
      let apiConfigId =
        typeof body.apiConfigId === 'string' ? body.apiConfigId.trim() : ''
      let modelOverride =
        typeof body.modelOverride === 'string' ? body.modelOverride : undefined
      if (!apiConfigId) {
        const hit = await resolvePluginCompleteApi({
          pluginId,
          conversationId:
            typeof body.conversationId === 'string'
              ? body.conversationId.trim()
              : undefined,
          apiConfigId: undefined,
        })
        if (!hit.ok) {
          return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
        }
        apiConfigId = hit.resolved.apiConfigId
        if (!modelOverride && hit.resolved.modelOverride) {
          modelOverride = hit.resolved.modelOverride
        }
      }
      const result = await runPluginComplete({
        apiConfigId,
        messages: Array.isArray(body.messages)
          ? (body.messages as { role: 'system' | 'user' | 'assistant'; content: string }[])
          : [],
        modelOverride,
        stream: body.stream === true,
        responseFormat:
          body.responseFormat === 'json_object' || body.responseFormat === 'text'
            ? body.responseFormat
            : undefined,
      })
      if (!result.ok) {
        if (result.code === 'upstream_error') {
          return reply.status(502).send({
            error: ApiErrorCodes.upstream_api_error,
            status: result.status,
            detail: result.detail,
          })
        }
        if (result.code === 'messages_empty') {
          return reply.status(400).send({ error: ApiErrorCodes.messages_required_nonempty })
        }
        if (result.code === 'messages_invalid') {
          return reply.status(400).send({ error: ApiErrorCodes.messages_item_role_content })
        }
        if (result.code === 'stream_not_supported') {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.plugin_complete_stream_not_supported })
        }
        if (
          result.code === 'api_config_not_found' ||
          result.code === 'api_credential_not_configured' ||
          result.code === 'missing_model'
        ) {
          const code = result.code as keyof typeof ApiErrorCodes
          return reply.status(400).send({ error: ApiErrorCodes[code] })
        }
        if (result.code === 'upstream_non_json' || result.code === 'upstream_empty_content') {
          return reply.status(502).send({
            error: ApiErrorCodes.upstream_non_json,
            detail: result.detail,
          })
        }
        return reply.status(502).send({
          error: ApiErrorCodes.plugin_complete_failed,
          detail: result.detail,
        })
      }
      return {
        ok: true as const,
        content: result.content,
        usage: result.usage,
        latencyMs: result.latencyMs,
      }
    },
  )

  app.post<{
    Params: { pluginId: string }
    Body: {
      conversationId?: string
      apiConfigId?: string
      messages?: { role: string; content: string }[]
    }
  }>(
    '/api/plugins/:pluginId/complete/preflight',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const auth = await assertPluginRoutePermission(pluginId, 'plugin.complete')
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
      const body = request.body ?? {}
      let apiConfigId =
        typeof body.apiConfigId === 'string' ? body.apiConfigId.trim() : ''
      if (!apiConfigId) {
        const hit = await resolvePluginCompleteApi({
          pluginId,
          conversationId:
            typeof body.conversationId === 'string'
              ? body.conversationId.trim()
              : undefined,
        })
        if (!hit.ok) {
          return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
        }
        apiConfigId = hit.resolved.apiConfigId
      }
      const result = await runPluginCompletePreflight({
        apiConfigId,
        messages: Array.isArray(body.messages)
          ? (body.messages as { role: 'system' | 'user' | 'assistant'; content: string }[])
          : [],
      })
      if (result.code === 'messages_empty') {
        return reply.status(400).send({ error: ApiErrorCodes.messages_required_nonempty })
      }
      if (result.code === 'messages_invalid') {
        return reply.status(400).send({ error: ApiErrorCodes.messages_item_role_content })
      }
      if (result.code === 'api_config_not_found') {
        return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
      }
      if (result.code === 'context_length_unconfigured') {
        return reply.status(400).send({
          error: ApiErrorCodes.plugin_complete_context_length_unconfigured,
          promptTokens: result.promptTokens,
        })
      }
      return {
        ok: result.ok,
        promptTokens: result.promptTokens,
        budget: result.budget,
        contextLength: result.contextLength,
        outputReserve: result.outputReserve,
        model: result.model,
        encoding: result.encoding,
        code: result.code,
      }
    },
  )

  app.post<{
    Params: { pluginId: string }
    Body: {
      conversationId?: string
      blocks?: unknown[]
    }
  }>(
    '/api/plugins/:pluginId/prepare-context',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const readAuth = await assertPluginRoutePermission(pluginId, 'conversation.read')
      if (!readAuth.ok) {
        return reply.status(readAuth.status).send({ error: ApiErrorCodes[readAuth.code] })
      }
      const body = request.body ?? {}
      const blockSpecs = parseContextBlockSpecs(body.blocks)
      if (blockSpecs.length === 0) {
        return reply.status(400).send({ error: ApiErrorCodes.plugin_prepare_context_failed })
      }
      if (contextBlockSpecsNeedLorebookRead(blockSpecs)) {
        const loreAuth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
        if (!loreAuth.ok) {
          return reply.status(loreAuth.status).send({ error: ApiErrorCodes[loreAuth.code] })
        }
      }

      const conversationId =
        typeof body.conversationId === 'string' ? body.conversationId : ''
      const blockResult = await runPluginContextBlocksResolve({
        conversationId,
        blocks: blockSpecs,
      })
      if (!blockResult.ok) {
        if (blockResult.code === 'conversation_not_found') {
          return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        }
        if (
          blockResult.code === 'invalid_conversation_id' ||
          blockResult.code === 'invalid_turn_range' ||
          blockResult.code === 'invalid_tail_count' ||
          blockResult.code === 'invalid_block_id' ||
          blockResult.code === 'blocks_required' ||
          blockResult.code === 'lorebook_id_required'
        ) {
          return reply.status(400).send({ error: ApiErrorCodes.plugin_prepare_context_failed })
        }
        if (blockResult.code === 'turn_range_too_large') {
          return reply.status(400).send({ error: ApiErrorCodes.turn_range_too_large })
        }
        if (blockResult.code === 'no_turns_in_range') {
          return reply.status(400).send({ error: ApiErrorCodes.no_turns_in_range })
        }
        return reply.status(400).send({ error: ApiErrorCodes.plugin_prepare_context_failed })
      }
      return blockResult
    },
  )

  app.post<{
    Params: { pluginId: string }
    Body: Record<string, unknown>
  }>(
    '/api/plugins/:pluginId/assemble-plugin-prompt',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const readAuth = await assertPluginRoutePermission(pluginId, 'conversation.read')
      if (!readAuth.ok) {
        return reply.status(readAuth.status).send({ error: ApiErrorCodes[readAuth.code] })
      }
      const parsed = parseAssemblePluginPromptBody(request.body ?? {})
      if (!parsed) {
        return reply.status(400).send({ error: ApiErrorCodes.plugin_assemble_prompt_failed })
      }
      const result = await runAssemblePluginPrompt(parsed)
      if (!result.ok) {
        if (result.code === 'context_exceeded') {
          return reply.status(400).send({
            error: ApiErrorCodes.plugin_complete_context_exceeded,
            ...(typeof result.promptTokens === 'number'
              ? { promptTokens: result.promptTokens }
              : {}),
            ...(typeof result.budget === 'number' ? { budget: result.budget } : {}),
          })
        }
        return reply.status(400).send({ error: ApiErrorCodes.plugin_assemble_prompt_failed })
      }
      return result
    },
  )

  app.post<{
    Params: { pluginId: string }
    Body: Record<string, unknown>
  }>(
    '/api/plugins/:pluginId/complete-with-context',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const readAuth = await assertPluginRoutePermission(pluginId, 'conversation.read')
      if (!readAuth.ok) {
        return reply.status(readAuth.status).send({ error: ApiErrorCodes[readAuth.code] })
      }
      const completeAuth = await assertPluginRoutePermission(pluginId, 'plugin.complete')
      if (!completeAuth.ok) {
        return reply.status(completeAuth.status).send({ error: ApiErrorCodes[completeAuth.code] })
      }
      const parsed = parseCompleteWithContextBody(request.body ?? {})
      if (!parsed) {
        return reply.status(400).send({ error: ApiErrorCodes.plugin_complete_with_context_failed })
      }
      const needsLore =
        !parsed.preparedContext && contextBlockSpecsNeedLorebookRead(parsed.blocks)
      if (needsLore) {
        const loreAuth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
        if (!loreAuth.ok) {
          return reply.status(loreAuth.status).send({ error: ApiErrorCodes[loreAuth.code] })
        }
      }
      const result = await runCompleteWithContext(pluginId, parsed, getCurrentUserId())
      if (!result.ok) {
        if (result.code === 'conversation_not_found') {
          return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        }
        const code = result.code
        const errorKey =
          code === 'parse_failed' || code === 'plugin_complete_draft_failed'
            ? 'plugin_complete_draft_failed'
            : code === 'context_exceeded'
              ? 'plugin_complete_context_exceeded'
              : code === 'context_length_unconfigured'
                ? 'plugin_complete_context_length_unconfigured'
                : code === 'turn_range_too_large'
                  ? 'turn_range_too_large'
                  : code === 'draft_kind_invalid'
                    ? 'plugin_complete_with_context_failed'
                    : code in ApiErrorCodes
                      ? code
                      : 'plugin_complete_with_context_failed'
        return reply.status(400).send({
          error: ApiErrorCodes[errorKey as keyof typeof ApiErrorCodes],
          code,
          ...(result.detail ? { detail: result.detail } : {}),
          ...(typeof result.promptTokens === 'number'
            ? { promptTokens: result.promptTokens }
            : {}),
          ...(typeof result.budget === 'number' ? { budget: result.budget } : {}),
        })
      }
      return result
    },
  )

  app.post<{
    Params: { pluginId: string }
    Body: {
      lorebookId?: string
      entryIds?: Record<string, string>
      validKeys?: string[]
    }
  }>(
    '/api/plugins/:pluginId/lorebooks/normalize-entry-refs',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const auth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
      const body = request.body ?? {}
      const result = await runNormalizeLorebookEntryRefs({
        lorebookId: typeof body.lorebookId === 'string' ? body.lorebookId : '',
        entryIds:
          body.entryIds && typeof body.entryIds === 'object' && !Array.isArray(body.entryIds)
            ? (body.entryIds as Record<string, string>)
            : {},
        validKeys: Array.isArray(body.validKeys)
          ? body.validKeys.filter((x): x is string => typeof x === 'string')
          : [],
      })
      if (!result.ok) {
        if (result.code === 'lorebook_not_found') {
          return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
        }
        if (result.code === 'lorebook_id_required') {
          return reply.status(400).send({ error: ApiErrorCodes.lorebook_id_required })
        }
        return reply.status(400).send({ error: ApiErrorCodes.lorebook_entry_patch_failed })
      }
      return result
    },
  )

  app.post<{
    Params: { pluginId: string; lorebookId: string }
    Body: {
      scope?: 'full' | 'partial'
      groupIds?: string[]
      entriesByGroup?: Record<string, string[]>
    }
  }>(
    '/api/plugins/:pluginId/lorebooks/:lorebookId/apply-order',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const lorebookId = request.params.lorebookId
      if (!LOREBOOK_ID_RE.test(lorebookId)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const auth = await assertPluginRoutePermission(pluginId, 'lorebook.entry.write')
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
      const body = request.body ?? {}
      const result = await runApplyLorebookOrder({
        lorebookId,
        scope: body.scope === 'full' ? 'full' : 'partial',
        groupIds: Array.isArray(body.groupIds) ? body.groupIds : undefined,
        entriesByGroup:
          body.entriesByGroup && typeof body.entriesByGroup === 'object'
            ? body.entriesByGroup
            : undefined,
      })
      if (!result.ok) {
        if (result.code === 'lorebook_not_found') {
          return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
        }
        if (result.code === 'lorebook_id_required') {
          return reply.status(400).send({ error: ApiErrorCodes.lorebook_id_required })
        }
        if (result.code.startsWith('order_')) {
          return reply.status(400).send({ error: ApiErrorCodes.lorebook_order_invalid })
        }
        return reply.status(400).send({ error: ApiErrorCodes.lorebook_entry_patch_failed })
      }
      return {
        ok: true,
        lorebook: result.lorebook,
        changed: result.changed,
        savedAt: result.savedAt,
      }
    },
  )

  app.post<{
    Params: { pluginId: string; action: string }
    Body: Record<string, unknown>
  }>(
    '/api/plugins/:pluginId/actions/:action',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const action = request.params.action.trim()
      const permissions = await listPluginActionPermissions(pluginId, action)
      if (!permissions?.length) {
        return reply.status(404).send({ error: ApiErrorCodes.plugin_hook_not_supported })
      }
      for (const perm of permissions) {
        const auth = await assertPluginRoutePermission(pluginId, perm)
        if (!auth.ok) {
          return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
        }
      }
      const body =
        request.body && typeof request.body === 'object' && !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {}
      const result = await runPluginActionRoute(pluginId, action, body)
      if (!result.ok) {
        const debugBody = result.debug ? { debug: result.debug } : {}
        if (
          result.code === 'plugin_action_not_supported' ||
          result.code === 'unknown_action'
        ) {
          return reply.status(404).send({ error: ApiErrorCodes.plugin_hook_not_supported })
        }
        if (result.code === 'invalid_conversation_id') {
          return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
        }
        if (result.code === 'turn_not_found' || result.code === 'no_turns') {
          return reply.status(404).send({ error: ApiErrorCodes.turn_chunk_not_found })
        }
        if (result.code === 'parse_failed') {
          return reply.status(mapPluginActionErrorStatus(result.code, result.status)).send({
            error: ApiErrorCodes.upstream_non_json,
            detail: result.code,
            ...debugBody,
          })
        }
        if (result.code === 'api_config_not_found') {
          return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
        }
        if (result.code === 'invalid_state') {
          return reply.status(422).send({ error: ApiErrorCodes.upstream_non_json })
        }
        return reply.status(mapPluginActionErrorStatus(result.code, result.status)).send({
          error: ApiErrorCodes.plugin_complete_failed,
          detail: result.code,
          ...debugBody,
        })
      }
      return result
    },
  )

  app.post<{
    Params: { pluginId: string }
    Body: {
      text?: string
      conversationId?: string
      apiConfigId?: string
      locale?: string
      toTurn?: number
      persistVars?: boolean
    }
  }>(
    '/api/plugins/:pluginId/macros/expand',
    async (request, reply) => {
      const pluginId = request.params.pluginId.trim()
      const auth = await assertPluginRoutePermission(pluginId, 'conversation.read')
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
      const body = request.body ?? {}
      const toTurnRaw = body.toTurn
      const toTurn =
        typeof toTurnRaw === 'number' &&
        Number.isInteger(toTurnRaw) &&
        toTurnRaw >= 0
          ? toTurnRaw
          : undefined
      const result = await runPluginMacroExpand({
        text: typeof body.text === 'string' ? body.text : '',
        conversationId:
          typeof body.conversationId === 'string' ? body.conversationId : undefined,
        apiConfigId:
          typeof body.apiConfigId === 'string' ? body.apiConfigId : undefined,
        locale: typeof body.locale === 'string' ? body.locale : undefined,
        toTurn,
        persistVars: body.persistVars !== false,
      })
      if (!result.ok) {
        return reply.status(400).send({ error: ApiErrorCodes.messages_required_nonempty })
      }
      return { ok: true as const, text: result.text }
    },
  )

  app.get<{ Params: { pluginId: string; name: string } }>(
    '/api/plugins/:pluginId/assets/:name',
    async (request, reply) => {
      const manifest = await readPluginManifest(request.params.pluginId)
      const asset = await readPluginBundledAsset(
        request.params.pluginId,
        request.params.name,
      )
      if (!asset) {
        return reply.status(404).send({ error: 'not_found' })
      }
      void manifest
      reply.header('Content-Type', asset.contentType)
      reply.header('Cache-Control', 'no-cache')
      return reply.send(asset.body)
    },
  )

  app.get<{ Params: { pluginId: string; name: string } }>(
    '/api/plugins/:pluginId/user-assets/:name',
    async (request, reply) => {
      const uid = getCurrentUserId()
      const asset = await readPluginUserAsset(
        request.params.pluginId,
        request.params.name,
        uid,
      )
      if (!asset) {
        return reply.status(404).send({ error: 'not_found' })
      }
      reply.header('Content-Type', asset.contentType)
      reply.header('Cache-Control', 'no-cache')
      return reply.send(asset.body)
    },
  )

  app.post<{ Params: { pluginId: string } }>(
    '/api/plugins/:pluginId/user-assets',
    async (request, reply) => {
      const parts = request.parts()
      let fileBuffer: Buffer | null = null
      let filename = ''
      let fieldKey = ''
      for await (const part of parts) {
        if (part.fieldname === 'file' && 'toBuffer' in part) {
          fileBuffer = await part.toBuffer()
          filename = part.filename ?? 'upload.bin'
        } else if (part.fieldname === 'fieldKey') {
          const v = (part as { value?: unknown }).value
          fieldKey = typeof v === 'string' ? v : ''
        }
      }
      if (!fileBuffer) {
        return reply.status(400).send({ error: 'file_required' })
      }
      try {
        const saved = await savePluginUserAssetUpload({
          pluginId: request.params.pluginId,
          userId: getCurrentUserId(),
          filename,
          buffer: fileBuffer,
          fieldKey: fieldKey || undefined,
        })
        return saved
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'upload_failed'
        if (msg === 'file_too_large') {
          return reply.status(413).send({ error: msg })
        }
        if (msg === 'invalid_extension' || msg === 'invalid_filename') {
          return reply.status(400).send({ error: msg })
        }
        return reply.status(404).send({ error: 'not_found' })
      }
    },
  )

  app.get<{ Params: { pluginId: string; file: string } }>(
    '/api/plugins/:pluginId/dist/:file',
    async (request, reply) => {
      const file = request.params.file?.trim()
      if (file !== 'web.mjs' && file !== 'server.mjs') {
        return reply.status(404).send({ error: 'not_found' })
      }
      const asset = await readPluginDistFile(
        request.params.pluginId,
        `dist/${file}`,
      )
      if (!asset) {
        return reply.status(404).send({ error: 'not_found' })
      }
      reply.header('Content-Type', asset.contentType)
      reply.header('Cache-Control', 'no-cache')
      return reply.send(asset.body)
    },
  )

  app.get<{ Params: { pluginId: string; locale: string } }>(
    '/api/plugins/:pluginId/locales/:locale',
    async (request, reply) => {
      const localeRaw = request.params.locale?.trim() ?? ''
      const locale = localeRaw.endsWith('.json')
        ? localeRaw.slice(0, -5)
        : localeRaw
      const asset = await readPluginLocaleFile(request.params.pluginId, locale)
      if (!asset) {
        return reply.status(404).send({ error: 'not_found' })
      }
      reply.header('Content-Type', 'application/json; charset=utf-8')
      reply.header('Cache-Control', 'no-cache')
      return reply.send(asset.body)
    },
  )
}
