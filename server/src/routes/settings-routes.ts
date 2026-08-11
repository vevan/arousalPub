import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from '../api-error-codes.js'
import { readApiSettingsFromFile, writeApiSettingsToFile, type ApiPreset, type ApiSettingsDocument } from '../api-settings-file.js'
import { parseDefaultAuthorsNotePatch } from '../authors-note-settings.js'
import { tryAcquireAuthRateLimitSlot } from '../auth-rate-limit.js'
import { readUserPreferencesDocument, updateGlobalHistorySettings, updateGlobalLorebookSettings, updateGlobalMemorySettings, updateGlobalKnowledgeSettings, updateGlobalBudgetTrimSettings, updateGlobalEmbeddingApiSettings, updateGlobalChunkSettings, updateGlobalDefaultAuthorsNote, updateGlobalHybridFtsSettings, updateGlobalPostUserInjectionOrder } from '../user-preferences-file.js'
import { normalizeHybridFtsProfile, normalizeHybridFtsSettings, type HybridFtsSettings } from '../hybrid-fts-settings.js'
import { clampInjectionOrder, normalizePostUserInjectionOrderHostPolicy, POST_USER_INJECTION_ORDER_HOST_KEYS, type PostUserInjectionOrderHostKey, type PostUserInjectionOrderHostPatch } from '../shared/post-user-injection-order.js'
import { parseBudgetTrimSettingsPatch } from '../budget-trim-settings.js'
import { parseMemorySettingsPatch } from '../memory-settings.js'
import { parseKnowledgeSettingsPatch } from '../knowledge-settings.js'
import { normalizeEmbeddingDimensions, normalizeEmbeddingApiSettings } from '../embedding-api-settings.js'
import { findUserById, readUsersIndex } from '../users-index.js'
import { readApiKeysDocument, writeApiKeysDocument, type ApiKeysDocument } from '../api-keys-file.js'
import { mergeApiKeysPutPayload, parseApiKeysPutPayload, sanitizeApiKeysDocumentForGet } from '../api-keys-sanitize.js'
import { mergeApiSettingsPut, sanitizeApiSettingsDocumentForGet, type ApiSettingsPutBody } from '../api-settings-sanitize.js'
import { ApiConfigInUseError, assertRemovedApiKeysNotInUse, deleteApiKeyFromFile, deleteApiPresetFromFile, findApiKeyReferences, findApiPresetReferences } from '../api-config-references.js'
import { ApiCredentialError, resolveChatCredentials } from '../api-credential-resolve.js'
import { testApiPresetConnectivity } from '../api-preset-test.js'
import { fetchUpstreamModelsList } from '../upstream-models.js'
import { sanitizeEmbeddingApiForGet } from '../embedding-api-sanitize.js'
import { verifyPassword } from '../auth-password.js'
import { getCurrentUserId } from '../user-context.js'
import {
  getBuiltinEmbeddingStatus,
  prepareBuiltinEmbedding,
  BuiltinEmbeddingPrepareRateLimitedError,
} from '../builtin-embedding.js'

interface ModelsListBody {
  baseUrl?: string
  apiPresetId?: string
  apiKeyId?: string | null
}


export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/embedding/builtin/status', async () =>
    getBuiltinEmbeddingStatus(),
  )

  app.post('/api/embedding/builtin/prepare', async (_request, reply) => {
    try {
      await prepareBuiltinEmbedding()
      return { ok: true as const, ...getBuiltinEmbeddingStatus() }
    } catch (e) {
      if (e instanceof BuiltinEmbeddingPrepareRateLimitedError) {
        return reply.status(429).send({
          ok: false as const,
          error: ApiErrorCodes.embedding_prepare_rate_limited,
          ...getBuiltinEmbeddingStatus(),
        })
      }
      app.log.error(e)
      return reply.status(502).send({
        ok: false as const,
        ...getBuiltinEmbeddingStatus(),
      })
    }
  })

  app.get('/api/user-preferences', async (_request, reply) => {
    try {
      const doc = await readUserPreferencesDocument()
      const embeddingApi = await sanitizeEmbeddingApiForGet(
        normalizeEmbeddingApiSettings(doc.embeddingApi),
      )
      return { ...doc, embeddingApi }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.user_preferences_read_failed })
    }
  })

  interface PatchUserPreferencesBody {
    lorebook?: {
      recursiveEnabled?: boolean
      maxRecursionDepth?: number
      keywordTopK?: number
      vectorEnabled?: boolean
      vectorTopK?: number
    }
    history?: {
      limitEnabled?: boolean
      maxTurns?: number
    }
    memory?: {
      memoryEnabled?: boolean
      memoryTopK?: number
      stripPluginBlocks?: boolean
      stripBlockTags?: string[]
      recallFuseLastAssistant?: boolean
      recallUserWeight?: number
    }
    knowledge?: {
      enabled?: boolean
      topK?: number
      chunkSizeChars?: number
      chunkOverlapChars?: number
    }
    budgetTrim?: {
      trimOrder?: ('knowledge' | 'lore' | 'memory' | 'history')[]
      minRetain?: {
        knowledge?: number
        lore?: number
        memory?: number
        history?: number
      }
    }
    embeddingApi?: {
      provider?: 'openai_compatible' | 'builtin'
      baseUrl?: string
      apiKey?: string
      apiKeyId?: string | null
      embeddingModel?: string
      embeddingDimensions?: number | null
    }
    chunk?: {
      turnsPerFile?: number
    }
    defaultAuthorsNote?: {
      content?: string
      injectionDepth?: number
      role?: 'system' | 'user'
      enabledForNewChats?: boolean
    } | null
    hybridFts?: {
      profile?: string
      dictVariant?: string | null
    }
    postUserInjectionOrder?: {
      default?: number
      afterUserInput?: number
      presetChatDepth0?: number
    } | null
  }

  app.patch<{ Body: PatchUserPreferencesBody }>(
    '/api/user-preferences',
    async (request, reply) => {
      const b = request.body ?? {}
      const hasLore = b.lorebook && typeof b.lorebook === 'object'
      const hasHist = b.history && typeof b.history === 'object'
      const hasMem = b.memory && typeof b.memory === 'object'
      const hasKnowledge = b.knowledge && typeof b.knowledge === 'object'
      const hasBudgetTrim = b.budgetTrim && typeof b.budgetTrim === 'object'
      const hasEmbed = b.embeddingApi && typeof b.embeddingApi === 'object'
      const hasChunk = b.chunk && typeof b.chunk === 'object'
      const hasDefaultAuthorsNote = Object.prototype.hasOwnProperty.call(
        b,
        'defaultAuthorsNote',
      )
      const hasHybridFts = b.hybridFts && typeof b.hybridFts === 'object'
      const hasPostUserInjectionOrder = Object.prototype.hasOwnProperty.call(
        b,
        'postUserInjectionOrder',
      )
      if (
        !hasLore &&
        !hasHist &&
        !hasMem &&
        !hasKnowledge &&
        !hasBudgetTrim &&
        !hasEmbed &&
        !hasChunk &&
        !hasDefaultAuthorsNote &&
        !hasHybridFts &&
        !hasPostUserInjectionOrder
      ) {
        return reply.status(400).send({
          error: ApiErrorCodes.user_preferences_requires_section,
        })
      }
      try {
        let lorebook
        let history
        let memory
        let knowledge
        let budgetTrim
        let embeddingApi
        let chunk
        let defaultAuthorsNote
        let hybridFts
        let postUserInjectionOrder
        if (hasLore) {
          const patch: {
            recursiveEnabled?: boolean
            maxRecursionDepth?: number
            keywordTopK?: number
            vectorEnabled?: boolean
            vectorTopK?: number
          } = {}
          if (Object.prototype.hasOwnProperty.call(b.lorebook, 'recursiveEnabled')) {
            if (typeof b.lorebook!.recursiveEnabled !== 'boolean') {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.lorebook_recursive_enabled_boolean })
            }
            patch.recursiveEnabled = b.lorebook!.recursiveEnabled
          }
          if (Object.prototype.hasOwnProperty.call(b.lorebook, 'maxRecursionDepth')) {
            const d = b.lorebook!.maxRecursionDepth
            if (typeof d !== 'number' || !Number.isFinite(d)) {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.lorebook_max_recursion_depth_number })
            }
            patch.maxRecursionDepth = d
          }
          if (Object.prototype.hasOwnProperty.call(b.lorebook, 'keywordTopK')) {
            const d = b.lorebook!.keywordTopK
            if (typeof d !== 'number' || !Number.isFinite(d)) {
              return reply.status(400).send({ error: ApiErrorCodes.lorebook_keyword_top_k_number })
            }
            patch.keywordTopK = d
          }
          if (Object.prototype.hasOwnProperty.call(b.lorebook, 'vectorEnabled')) {
            if (typeof b.lorebook!.vectorEnabled !== 'boolean') {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.lorebook_vector_enabled_boolean })
            }
            patch.vectorEnabled = b.lorebook!.vectorEnabled
          }
          if (Object.prototype.hasOwnProperty.call(b.lorebook, 'vectorTopK')) {
            const d = b.lorebook!.vectorTopK
            if (typeof d !== 'number' || !Number.isFinite(d)) {
              return reply.status(400).send({ error: ApiErrorCodes.lorebook_vector_top_k_number })
            }
            patch.vectorTopK = d
          }
          if (Object.keys(patch).length === 0) {
            return reply.status(400).send({
              error: ApiErrorCodes.global_lorebook_requires_field,
            })
          }
          lorebook = await updateGlobalLorebookSettings(patch)
        }
        if (hasHist) {
          const patch: {
            limitEnabled?: boolean
            maxTurns?: number
          } = {}
          if (Object.prototype.hasOwnProperty.call(b.history, 'limitEnabled')) {
            if (typeof b.history!.limitEnabled !== 'boolean') {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.history_limit_enabled_boolean })
            }
            patch.limitEnabled = b.history!.limitEnabled
          }
          if (Object.prototype.hasOwnProperty.call(b.history, 'maxTurns')) {
            const d = b.history!.maxTurns
            if (typeof d !== 'number' || !Number.isFinite(d)) {
              return reply.status(400).send({ error: ApiErrorCodes.history_max_turns_number })
            }
            patch.maxTurns = d
          }
          if (
            !Object.prototype.hasOwnProperty.call(patch, 'limitEnabled') &&
            !Object.prototype.hasOwnProperty.call(patch, 'maxTurns')
          ) {
            return reply.status(400).send({
              error: ApiErrorCodes.global_history_requires_field,
            })
          }
          history = await updateGlobalHistorySettings(patch)
        }
        if (hasMem) {
          const parsed = parseMemorySettingsPatch(b.memory, 'global')
          if (!parsed.ok) {
            const code = parsed.error as keyof typeof ApiErrorCodes
            return reply
              .status(400)
              .send({ error: ApiErrorCodes[code] ?? ApiErrorCodes.memory_settings_invalid })
          }
          memory = await updateGlobalMemorySettings(parsed.patch)
        }
        if (hasKnowledge) {
          const parsed = parseKnowledgeSettingsPatch(b.knowledge)
          if (!parsed) {
            return reply.status(400).send({ error: ApiErrorCodes.knowledge_settings_invalid })
          }
          knowledge = await updateGlobalKnowledgeSettings(parsed)
        }
        if (hasBudgetTrim) {
          const parsed = parseBudgetTrimSettingsPatch(b.budgetTrim)
          if (!parsed.ok) {
            const code = parsed.error as keyof typeof ApiErrorCodes
            return reply
              .status(400)
              .send({ error: ApiErrorCodes[code] ?? ApiErrorCodes.budget_trim_settings_invalid })
          }
          budgetTrim = await updateGlobalBudgetTrimSettings(parsed.patch)
        }
        if (hasEmbed) {
          const raw = b.embeddingApi! as {
            provider?: string
            baseUrl?: string
            apiKey?: string
            apiKeyId?: string | null
            embeddingModel?: string
            embeddingDimensions?: number | null
          }
          const patch: {
            provider?: 'openai_compatible' | 'builtin'
            baseUrl?: string
            apiKey?: string
            apiKeyId?: string | null
            embeddingModel?: string
            embeddingDimensions?: number | null
          } = {}
          if (Object.prototype.hasOwnProperty.call(raw, 'provider')) {
            if (
              raw.provider !== 'openai_compatible' &&
              raw.provider !== 'builtin'
            ) {
              return reply.status(400).send({ error: ApiErrorCodes.embedding_provider_invalid })
            }
            patch.provider = raw.provider
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'baseUrl')) {
            if (typeof raw.baseUrl !== 'string') {
              return reply.status(400).send({ error: ApiErrorCodes.embedding_api_base_url_string })
            }
            patch.baseUrl = raw.baseUrl
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'apiKey')) {
            if (typeof raw.apiKey !== 'string') {
              return reply.status(400).send({ error: ApiErrorCodes.embedding_api_api_key_string })
            }
            patch.apiKey = raw.apiKey
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'apiKeyId')) {
            const kid = raw.apiKeyId
            if (kid !== null && typeof kid !== 'string') {
              return reply.status(400).send({ error: ApiErrorCodes.embedding_api_api_key_id_invalid })
            }
            patch.apiKeyId = kid
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'embeddingModel')) {
            if (typeof raw.embeddingModel !== 'string') {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.embedding_api_embedding_model_string })
            }
            patch.embeddingModel = raw.embeddingModel
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'embeddingDimensions')) {
            const dim = raw.embeddingDimensions
            if (dim !== null && typeof dim !== 'number') {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.embedding_api_embedding_dimensions_invalid })
            }
            patch.embeddingDimensions =
              dim === null ? null : normalizeEmbeddingDimensions(dim)
          }
          if (Object.keys(patch).length === 0) {
            return reply.status(400).send({
              error: ApiErrorCodes.global_embedding_api_requires_field,
            })
          }
          embeddingApi = await updateGlobalEmbeddingApiSettings(patch)
        }
        if (hasChunk) {
          if (!Object.prototype.hasOwnProperty.call(b.chunk, 'turnsPerFile')) {
            return reply.status(400).send({
              error: ApiErrorCodes.global_chunk_requires_field,
            })
          }
          const d = b.chunk!.turnsPerFile
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.chunk_turns_per_file_number })
          }
          chunk = await updateGlobalChunkSettings({ turnsPerFile: d })
        }
        if (hasDefaultAuthorsNote) {
          const parsed = parseDefaultAuthorsNotePatch(b.defaultAuthorsNote)
          if (!parsed.ok) {
            const code = parsed.error as keyof typeof ApiErrorCodes
            return reply
              .status(400)
              .send({ error: ApiErrorCodes[code] ?? ApiErrorCodes.default_authors_note_invalid })
          }
          defaultAuthorsNote = await updateGlobalDefaultAuthorsNote(parsed.patch)
        }
        if (hasHybridFts) {
          const patch: Partial<HybridFtsSettings> = {}
          if (Object.prototype.hasOwnProperty.call(b.hybridFts, 'profile')) {
            const rawProfile = b.hybridFts!.profile
            const normalized = normalizeHybridFtsProfile(rawProfile)
            if (typeof rawProfile !== 'string' || normalized !== rawProfile) {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.hybrid_fts_profile_invalid })
            }
            patch.profile = normalized
          }
          if (Object.prototype.hasOwnProperty.call(b.hybridFts, 'dictVariant')) {
            const rawVariant = b.hybridFts!.dictVariant
            if (rawVariant !== null && typeof rawVariant !== 'string') {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.hybrid_fts_dict_variant_invalid })
            }
            if (rawVariant !== null) {
              const docForVariant = await readUserPreferencesDocument()
              const normalizedSettings = normalizeHybridFtsSettings({
                profile: patch.profile ?? docForVariant.hybridFts?.profile,
                dictVariant: rawVariant,
              })
              if (rawVariant !== normalizedSettings.dictVariant) {
                return reply
                  .status(400)
                  .send({ error: ApiErrorCodes.hybrid_fts_dict_variant_invalid })
              }
              patch.dictVariant = normalizedSettings.dictVariant
            } else {
              patch.dictVariant = null
            }
          }
          if (
            !Object.prototype.hasOwnProperty.call(patch, 'profile') &&
            !Object.prototype.hasOwnProperty.call(patch, 'dictVariant')
          ) {
            return reply.status(400).send({
              error: ApiErrorCodes.user_preferences_requires_section,
            })
          }
          hybridFts = await updateGlobalHybridFtsSettings(patch)
        }
        if (hasPostUserInjectionOrder) {
          if (b.postUserInjectionOrder === null) {
            postUserInjectionOrder = await updateGlobalPostUserInjectionOrder(null)
          } else if (
            b.postUserInjectionOrder &&
            typeof b.postUserInjectionOrder === 'object' &&
            !Array.isArray(b.postUserInjectionOrder)
          ) {
            const patch: PostUserInjectionOrderHostPatch = {}
            for (const key of POST_USER_INJECTION_ORDER_HOST_KEYS) {
              if (
                !Object.prototype.hasOwnProperty.call(b.postUserInjectionOrder, key)
              ) {
                continue
              }
              const raw = b.postUserInjectionOrder[key as PostUserInjectionOrderHostKey]
              if (typeof raw !== 'number' || !Number.isFinite(raw)) {
                return reply.status(400).send({
                  error: ApiErrorCodes.post_user_injection_order_invalid,
                })
              }
              patch[key as PostUserInjectionOrderHostKey] = clampInjectionOrder(raw)
            }
            postUserInjectionOrder = await updateGlobalPostUserInjectionOrder(
              Object.keys(patch).length > 0 ? patch : null,
            )
          } else {
            return reply.status(400).send({
              error: ApiErrorCodes.post_user_injection_order_invalid,
            })
          }
        }
        const doc = await readUserPreferencesDocument()
        const embeddingPublic = embeddingApi
          ? await sanitizeEmbeddingApiForGet(embeddingApi)
          : await sanitizeEmbeddingApiForGet(
              normalizeEmbeddingApiSettings(doc.embeddingApi),
            )
        return {
          ok: true as const,
          lorebook: lorebook ?? doc.lorebook,
          history: history ?? doc.history,
          memory: memory ?? doc.memory,
          knowledge: knowledge ?? doc.knowledge,
          budgetTrim: budgetTrim ?? doc.budgetTrim,
          embeddingApi: embeddingPublic,
          chunk: chunk ?? doc.chunk,
          defaultAuthorsNote: defaultAuthorsNote ?? doc.defaultAuthorsNote,
          hybridFts: hybridFts ?? doc.hybridFts,
          postUserInjectionOrder:
            postUserInjectionOrder ??
            normalizePostUserInjectionOrderHostPolicy(doc.postUserInjectionOrder),
          savedAt: doc.savedAt,
        }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.user_preferences_save_failed })
      }
    },
  )

  interface EmbeddingTestBody {
    text?: string
    embeddingApi?: {
      provider?: 'openai_compatible' | 'builtin'
      baseUrl?: string
      apiKey?: string
      apiKeyId?: string | null
      embeddingModel?: string
      embeddingDimensions?: number | null
    }
  }

  app.post<{ Body: EmbeddingTestBody }>(
    '/api/embedding/test',
    async (request, reply) => {
      try {
        const b = request.body ?? {}
        const text =
          typeof b.text === 'string' && b.text.trim()
            ? b.text.trim()
            : '这是一句用于测试 embedding 的短句。'
        const { resolveEmbeddingApiCredentialsFrom } = await import('../embedding-credential-resolve.js'
        )
        const { createEmbeddingWithCredentials, buildEmbeddingRequestUrl } =
          await import('../embedding-client.js')
        const creds = await resolveEmbeddingApiCredentialsFrom(
          b.embeddingApi && typeof b.embeddingApi === 'object'
            ? b.embeddingApi
            : undefined,
        )
        const result = await createEmbeddingWithCredentials(creds, text)
        if ('error' in result) {
          const httpStatus =
            typeof result.status === 'number' &&
            result.status >= 400 &&
            result.status < 600
              ? result.status
              : result.error === ApiErrorCodes.builtin_embedding_input_too_large
                ? 400
                : 502
          return reply.status(httpStatus).send({
            ok: false as const,
            error: result.error,
            status: result.status,
            detail: result.detail,
            ...(creds.provider === 'openai_compatible'
              ? { requestUrl: buildEmbeddingRequestUrl(creds.baseUrl) }
              : {}),
          })
        }
        return {
          ok: true as const,
          provider: creds.provider,
          model: result.model,
          dimensions: result.vector.length,
          profile: creds.embeddingProfile,
          inputText: text,
          ...(creds.provider === 'openai_compatible'
            ? { requestUrl: buildEmbeddingRequestUrl(creds.baseUrl) }
            : {}),
          // Preview only — avoid returning the full embedding vector to clients.
          vectorPreview: result.vector.slice(0, 8),
        }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ ok: false, error: ApiErrorCodes.embedding_test_failed })
      }
    },
  )

  app.get('/api/settings', async (_request, reply) => {
    try {
      const data = await readApiSettingsFromFile()
      if (!data) return null
      return await sanitizeApiSettingsDocumentForGet(data)
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.settings_read_failed })
    }
  })

  type SettingsPutBody = ApiSettingsPutBody

  app.put<{ Body: SettingsPutBody }>('/api/settings', async (request, reply) => {
    const b = request.body
    if (!b || typeof b !== 'object') {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
    }
    if (!Array.isArray(b.presets)) {
      return reply.status(400).send({ error: ApiErrorCodes.missing_presets_array })
    }
    const activePresetId =
      typeof b.activePresetId === 'string' ? b.activePresetId : ''
    if (!(b.presets as ApiPreset[]).some((p) => p.id === activePresetId)) {
      return reply.status(400).send({ error: ApiErrorCodes.active_preset_id_mismatch })
    }

    let doc: ApiSettingsDocument
    try {
      doc = await mergeApiSettingsPut({
        activePresetId,
        presets: b.presets,
      })
    } catch (e) {
      return reply.status(400).send({
        error: ApiErrorCodes.preset_validation_failed,
      })
    }

    try {
      await writeApiSettingsToFile(doc)
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.settings_write_failed })
    }

    return { ok: true as const, savedAt: doc.savedAt }
  })

  app.post<{ Params: { id: string }; Body: { baseUrl?: string; model?: string } }>(
    '/api/settings/presets/:id/test',
    async (request, reply) => {
      const presetId = request.params.id?.trim() ?? ''
      if (!presetId) {
        return reply.status(400).send({ ok: false, error: ApiErrorCodes.invalid_id })
      }
      const body = request.body ?? {}
      const baseUrl =
        typeof body.baseUrl === 'string' ? body.baseUrl : undefined
      const model = typeof body.model === 'string' ? body.model : undefined
      try {
        const result = await testApiPresetConnectivity({
          apiPresetId: presetId,
          baseUrl,
          model,
        })
        if (!result.ok) {
          const status =
            result.error === 'missing_api_key' ||
            result.error === 'api_credential_not_configured' ||
            result.error === 'missing_model' ||
            result.error === 'invalid_id'
              ? 400
              : 502
          return reply.status(status).send(result)
        }
        return result
      } catch (e) {
        app.log.error(e)
        return reply
          .status(500)
          .send({ ok: false, error: ApiErrorCodes.api_preset_test_failed })
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/settings/presets/:id/references',
    async (request, reply) => {
      const presetId = request.params.id?.trim() ?? ''
      if (!presetId) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      try {
        const settings = await readApiSettingsFromFile()
        if (!settings?.presets.some((p) => p.id === presetId)) {
          return reply.status(404).send({ error: ApiErrorCodes.api_preset_not_found })
        }
        const references = await findApiPresetReferences(presetId)
        return { references }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.settings_read_failed })
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/settings/presets/:id',
    async (request, reply) => {
      const presetId = request.params.id?.trim() ?? ''
      if (!presetId) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      try {
        const { activePresetId } = await deleteApiPresetFromFile(presetId)
        return { ok: true as const, activePresetId }
      } catch (e) {
        if (e instanceof ApiConfigInUseError) {
          const status =
            e.code === 'api_preset_not_found'
              ? 404
              : e.code === 'api_preset_last_one'
                ? 400
                : 409
          return reply.status(status).send({
            error: e.code,
            references: e.references,
          })
        }
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.settings_write_failed })
      }
    },
  )

  app.get('/api/api-keys', async (_request, reply) => {
    try {
      const data = await readApiKeysDocument()
      if (!data) return null
      return sanitizeApiKeysDocumentForGet(data)
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.api_keys_read_failed })
    }
  })

  app.put('/api/api-keys', async (request, reply) => {
    let validated: { keys: ReturnType<typeof parseApiKeysPutPayload>['keys'] }
    try {
      validated = parseApiKeysPutPayload(request.body)
    } catch (e) {
      return reply.status(400).send({
        error: ApiErrorCodes.api_keys_validation_failed,
      })
    }
    let mergedKeys: ApiKeysDocument['keys']
    try {
      const existing = await readApiKeysDocument()
      const incomingIds = new Set(validated.keys.map((k) => k.id))
      await assertRemovedApiKeysNotInUse(incomingIds, existing?.keys ?? [])
      mergedKeys = await mergeApiKeysPutPayload(validated.keys)
    } catch (e) {
      if (e instanceof ApiConfigInUseError) {
        return reply.status(409).send({
          error: e.code,
          references: e.references,
        })
      }
      return reply.status(400).send({
        error: ApiErrorCodes.api_keys_validation_failed,
      })
    }
    const savedAt = new Date().toISOString()
    const doc: ApiKeysDocument = {
      version: 1,
      savedAt,
      keys: mergedKeys,
    }
    try {
      await writeApiKeysDocument(doc)
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.api_keys_write_failed })
    }
    return { ok: true as const, savedAt }
  })

  app.get<{ Params: { id: string } }>(
    '/api/api-keys/:id/references',
    async (request, reply) => {
      const keyId = request.params.id?.trim() ?? ''
      if (!keyId) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      try {
        const doc = await readApiKeysDocument()
        if (!doc?.keys.some((k) => k.id === keyId)) {
          return reply.status(404).send({ error: ApiErrorCodes.api_key_not_found })
        }
        const references = await findApiKeyReferences(keyId)
        return { references }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.api_keys_read_failed })
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/api-keys/:id',
    async (request, reply) => {
      const keyId = request.params.id?.trim() ?? ''
      if (!keyId) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      try {
        await deleteApiKeyFromFile(keyId)
        return { ok: true as const }
      } catch (e) {
        if (e instanceof ApiConfigInUseError) {
          const status = e.code === 'api_key_not_found' ? 404 : 409
          return reply.status(status).send({
            error: e.code,
            references: e.references,
          })
        }
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.api_keys_write_failed })
      }
    },
  )

  app.post<{ Params: { id: string }; Body: { password?: string } }>(
    '/api/api-keys/:id/reveal',
    async (request, reply) => {
      if (!tryAcquireAuthRateLimitSlot('api_key_reveal', request.ip)) {
        return reply.status(429).send({ error: ApiErrorCodes.auth_rate_limited })
      }
      const keyId = request.params.id?.trim()
      if (!keyId) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const password = request.body?.password
      if (typeof password !== 'string' || !password) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_password_fields })
      }
      try {
        const userId = getCurrentUserId()
        const doc = await readUsersIndex()
        const user = findUserById(doc, userId)
        if (!user) {
          return reply.status(401).send({ error: ApiErrorCodes.invalid_user })
        }
        const ok = await verifyPassword(password, user.passwordHash)
        if (!ok) {
          return reply.status(403).send({
            error: ApiErrorCodes.api_key_reveal_wrong_password,
          })
        }
        const keysDoc = await readApiKeysDocument()
        const hit = keysDoc?.keys.find((k) => k.id === keyId)
        if (!hit) {
          return reply.status(404).send({ error: ApiErrorCodes.api_key_not_found })
        }
        return { key: hit.key }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.api_key_reveal_failed })
      }
    },
  )

  app.post<{ Body: ModelsListBody }>('/api/models', async (request, reply) => {
    const b = request.body ?? ({} as ModelsListBody)
    let apiKey: string
    let baseUrl: string
    try {
      const creds = await resolveChatCredentials({
        apiPresetId: b.apiPresetId,
        apiKeyId: b.apiKeyId,
        baseUrl: b.baseUrl,
      })
      apiKey = creds.apiKey
      baseUrl = creds.baseUrl
    } catch (e) {
      if (e instanceof ApiCredentialError) {
        return reply.status(400).send({ error: e.code })
      }
      throw e
    }
    const result = await fetchUpstreamModelsList({ baseUrl, apiKey })
    if (!result.ok) {
      request.log.warn(
        { status: result.status, body: result.detail?.slice(0, 400) },
        'models list upstream error',
      )
      return reply.status(502).send({
        error: ApiErrorCodes.models_list_failed,
        status: result.status,
        detail: result.detail,
      })
    }
    return { models: result.models }
  })
}
