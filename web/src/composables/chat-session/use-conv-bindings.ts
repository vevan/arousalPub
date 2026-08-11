import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import {
  authorsNoteFromIndex,
  normalizeAuthorsNote,
} from '@/utils/authors-note-settings'
import {
  hasBudgetTrimSettingsOverride,
  normalizeBudgetTrimSettings,
  resolveBudgetTrimSettings,
  type BudgetTrimSettings,
} from '@/utils/budget-trim-settings'
import {
  hasConversationChatOverride,
  hasConversationEmbeddingOverride,
  readConversationEmbeddingOverride,
  resolveConversationChatDisplay,
  resolveConversationEmbeddingModelSettings,
} from '@/utils/conversation-api-settings'
import {
  normalizeGroupChatSettings,
} from '@/utils/group-chat-settings'
import {
  hasHistorySettingsOverride,
  normalizeHistorySettings,
  resolveHistorySettings,
  type HistorySettings,
} from '@/utils/history-settings'
import {
  hasKnowledgeSettingsOverride,
  normalizeKnowledgeSettings,
  resolveKnowledgeSettings,
  type KnowledgeSettings,
} from '@/utils/knowledge-settings'
import {
  hasLorebookSettingsOverride,
  normalizeLorebookSettings,
  resolveLorebookSettings,
  type LorebookSettings,
} from '@/utils/lorebook-settings'
import {
  hasMemorySettingsOverride,
  normalizeMemorySettings,
  resolveMemorySettings,
  type MemorySettings,
} from '@/utils/memory-settings'
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import { resolveEmbeddingIdentity } from '@/utils/embedding-api-settings'
import type {
  ApiContextBinding,
  BudgetTrimContextBinding,
  ConvContextBindings,
  EmbeddingApiContextBinding,
  HistoryContextBinding,
  KnowledgeContextBinding,
  LorebookContextBinding,
  MemoryContextBinding,
} from './conv-bindings-types'

export type {
  ApiContextBinding,
  BudgetTrimContextBinding,
  ConvContextBindings,
  EmbeddingApiContextBinding,
  HistoryContextBinding,
  KnowledgeContextBinding,
  LorebookContextBinding,
  MemoryContextBinding,
} from './conv-bindings-types'

function emptyConvBindings(): ConvContextBindings {
  return {
    promptPresetId: null,
    characterIds: [],
    characterNames: [],
    groupChatEnabled: false,
    groupChat: normalizeGroupChatSettings(undefined),
    lorebookIds: [],
    knowledgeBaseIds: [],
    knowledge: {
      useGlobal: true,
      effective: normalizeKnowledgeSettings(),
    },
    lorebook: {
      useGlobal: true,
      effective: {
        recursiveEnabled: false,
        maxRecursionDepth: 2,
        keywordTopK: 64,
        vectorEnabled: false,
        vectorTopK: 5,
      },
    },
    history: {
      useGlobal: true,
      effective: { limitEnabled: false, maxTurns: 20 },
    },
    memory: {
      useGlobal: true,
      effective: normalizeMemorySettings(),
    },
    budgetTrim: {
      useGlobal: true,
      effective: normalizeBudgetTrimSettings(),
    },
    chatApi: {
      useGlobal: true,
      effective: null,
      apiPresetRaw: undefined,
    },
    embeddingApi: {
      useGlobal: true,
      effective: resolveEmbeddingIdentity({
        provider: 'openai_compatible',
        baseUrl: '',
        embeddingModel: '',
        embeddingDimensions: null,
      }),
    },
    userName: null,
    userCharacterId: null,
    backgroundImageFileId: null,
    bgmFileId: null,
    authorsNote: normalizeAuthorsNote(),
  }
}

export function useConvBindings() {
  const prefStore = usePreferencesStore()
  const conn = useConnectionStore()
  const {
    lorebookRecursiveEnabled,
    lorebookMaxRecursionDepth,
    lorebookKeywordTopK,
    lorebookVectorEnabled,
    lorebookVectorTopK,
    historyLimitEnabled,
    historyMaxTurns,
    memoryEnabled,
    memoryTopK,
    knowledgeEnabled,
    knowledgeTopK,
    knowledgeChunkSizeChars,
    knowledgeChunkOverlapChars,
    budgetTrimSettings,
    embeddingProvider,
    embeddingBaseUrl,
    embeddingModel,
    embeddingDimensions,
  } = storeToRefs(prefStore)

  const convBindings = ref<ConvContextBindings>(emptyConvBindings())

  function globalLoreFromStore(): LorebookSettings {
    return normalizeLorebookSettings({
      recursiveEnabled: prefStore.lorebookRecursiveEnabled,
      maxRecursionDepth: prefStore.lorebookMaxRecursionDepth,
      keywordTopK: prefStore.lorebookKeywordTopK,
      vectorEnabled: prefStore.lorebookVectorEnabled,
      vectorTopK: prefStore.lorebookVectorTopK,
    })
  }

  function globalHistoryFromStore(): HistorySettings {
    return normalizeHistorySettings({
      limitEnabled: prefStore.historyLimitEnabled,
      maxTurns: prefStore.historyMaxTurns,
    })
  }

  function globalMemoryFromStore(): MemorySettings {
    return normalizeMemorySettings({
      memoryEnabled: prefStore.memoryEnabled,
      memoryTopK: prefStore.memoryTopK,
      stripPluginBlocks: prefStore.memoryStripPluginBlocks,
      stripBlockTags: prefStore.memoryStripBlockTags,
      recallFuseLastAssistant: prefStore.memoryRecallFuseLastAssistant,
      recallUserWeight: prefStore.memoryRecallUserWeight,
    })
  }

  function globalBudgetTrimFromStore(): BudgetTrimSettings {
    return normalizeBudgetTrimSettings(budgetTrimSettings.value)
  }

  function globalKnowledgeFromStore(): KnowledgeSettings {
    return normalizeKnowledgeSettings({
      enabled: knowledgeEnabled.value,
      topK: knowledgeTopK.value,
      chunkSizeChars: knowledgeChunkSizeChars.value,
      chunkOverlapChars: knowledgeChunkOverlapChars.value,
    })
  }

  function knowledgeContextFromIndex(
    idx: Record<string, unknown>,
  ): KnowledgeContextBinding {
    const global = globalKnowledgeFromStore()
    const raw = idx.knowledgeSettings
    const override =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Partial<KnowledgeSettings>)
        : undefined
    const useGlobal = !hasKnowledgeSettingsOverride(override)
    return {
      useGlobal,
      effective: resolveKnowledgeSettings(global, override),
    }
  }

  function memoryContextFromIndex(
    idx: Record<string, unknown>,
  ): MemoryContextBinding {
    const global = globalMemoryFromStore()
    const raw = idx.memorySettings
    const override =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Partial<MemorySettings>)
        : undefined
    const useGlobal = !hasMemorySettingsOverride(override)
    return {
      useGlobal,
      effective: resolveMemorySettings(global, override),
    }
  }

  function historyContextFromIndex(
    idx: Record<string, unknown>,
  ): HistoryContextBinding {
    const global = globalHistoryFromStore()
    const raw = idx.historySettings
    const override =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Partial<HistorySettings>)
        : undefined
    const useGlobal = !hasHistorySettingsOverride(override)
    return {
      useGlobal,
      effective: resolveHistorySettings(global, override),
    }
  }

  function budgetTrimContextFromIndex(
    idx: Record<string, unknown>,
  ): BudgetTrimContextBinding {
    const global = globalBudgetTrimFromStore()
    const raw = idx.budgetTrimSettings
    const override =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Partial<BudgetTrimSettings>)
        : undefined
    const useGlobal = !hasBudgetTrimSettingsOverride(override)
    return {
      useGlobal,
      effective: resolveBudgetTrimSettings(global, override),
    }
  }

  function lorebookContextFromIndex(
    idx: Record<string, unknown>,
  ): LorebookContextBinding {
    const global = globalLoreFromStore()
    const raw = idx.lorebookSettings
    const override =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Partial<LorebookSettings>)
        : undefined
    const useGlobal = !hasLorebookSettingsOverride(override)
    return {
      useGlobal,
      effective: resolveLorebookSettings(global, override),
    }
  }

  function clientResolvedCharacterIds(idx: Record<string, unknown>): string[] {
    if (Array.isArray(idx.characterIds)) {
      const seen = new Set<string>()
      const out: string[] = []
      for (const raw of idx.characterIds) {
        if (typeof raw !== 'string') continue
        const id = raw.trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push(id)
      }
      return out
    }
    return []
  }

  function globalEmbeddingFromStore() {
    return resolveEmbeddingIdentity({
      provider: embeddingProvider.value,
      baseUrl: embeddingBaseUrl.value,
      embeddingModel: embeddingModel.value.trim(),
      embeddingDimensions: embeddingDimensions.value,
    })
  }

  function chatApiContextFromIndex(idx: Record<string, unknown>): ApiContextBinding {
    const apiPresetRaw = idx.apiPreset
    const useGlobal = !hasConversationChatOverride(apiPresetRaw)
    const effective = resolveConversationChatDisplay(
      conn.presets,
      conn.activePresetId,
      apiPresetRaw,
    )
    return { useGlobal, effective, apiPresetRaw }
  }

  function embeddingApiContextFromIndex(
    idx: Record<string, unknown>,
  ): EmbeddingApiContextBinding {
    const global = globalEmbeddingFromStore()
    const override = readConversationEmbeddingOverride(idx)
    const useGlobal = !hasConversationEmbeddingOverride(override)
    if (global.provider === 'builtin') {
      return { useGlobal, effective: global, override }
    }
    const resolved = resolveConversationEmbeddingModelSettings(global, override)
    return {
      useGlobal,
      effective: resolveEmbeddingIdentity({
        provider: 'openai_compatible',
        baseUrl: embeddingBaseUrl.value,
        ...resolved,
      }),
      override,
    }
  }

  function bindingsFromIndex(idx: Record<string, unknown>): ConvContextBindings {
    const pid = idx.promptPresetId
    const promptPresetId =
      typeof pid === 'string' && pid.trim() ? pid.trim() : null
    const lb = idx.lorebookIds
    const lorebookIds = Array.isArray(lb)
      ? lb.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    const kb = idx.knowledgeBaseIds
    const knowledgeBaseIds = Array.isArray(kb)
      ? kb.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    const un = idx.userName
    const userName =
      typeof un === 'string' && un.trim() ? un.trim() : null
    const uci = idx.userCharacterId
    const userCharacterId =
      typeof uci === 'string' && uci.trim() ? uci.trim() : null
    const bgImg = idx.backgroundImageFileId
    const backgroundImageFileId =
      typeof bgImg === 'string' && bgImg.trim() ? bgImg.trim().toLowerCase() : null
    const bgm = idx.bgmFileId
    const bgmFileId =
      typeof bgm === 'string' && bgm.trim() ? bgm.trim().toLowerCase() : null
    const cn = idx.characterNames
    const characterNames = Array.isArray(cn)
      ? cn.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    const groupChat = normalizeGroupChatSettings(idx.groupChat)
    const groupChatEnabled = groupChat.enabled === true
    return {
      promptPresetId,
      characterIds: clientResolvedCharacterIds(idx),
      characterNames,
      groupChatEnabled,
      groupChat,
      lorebookIds,
      knowledgeBaseIds,
      knowledge: knowledgeContextFromIndex(idx),
      lorebook: lorebookContextFromIndex(idx),
      history: historyContextFromIndex(idx),
      memory: memoryContextFromIndex(idx),
      budgetTrim: budgetTrimContextFromIndex(idx),
      chatApi: chatApiContextFromIndex(idx),
      embeddingApi: embeddingApiContextFromIndex(idx),
      userName,
      userCharacterId,
      backgroundImageFileId,
      bgmFileId,
      authorsNote: authorsNoteFromIndex(idx),
    }
  }

  watch(
    [
      lorebookRecursiveEnabled,
      lorebookMaxRecursionDepth,
      lorebookKeywordTopK,
      lorebookVectorEnabled,
      lorebookVectorTopK,
    ],
    () => {
      if (!convBindings.value.lorebook.useGlobal) return
      const global = globalLoreFromStore()
      convBindings.value = {
        ...convBindings.value,
        lorebook: {
          useGlobal: true,
          effective: global,
        },
      }
    },
  )

  watch([historyLimitEnabled, historyMaxTurns], () => {
    if (!convBindings.value.history.useGlobal) return
    const global = globalHistoryFromStore()
    convBindings.value = {
      ...convBindings.value,
      history: {
        useGlobal: true,
        effective: global,
      },
    }
  })

  watch([embeddingProvider, embeddingBaseUrl, embeddingModel, embeddingDimensions], () => {
    const current = convBindings.value.embeddingApi
    const global = globalEmbeddingFromStore()
    const effective = global.provider === 'builtin'
      ? global
      : resolveEmbeddingIdentity({
          provider: 'openai_compatible',
          baseUrl: embeddingBaseUrl.value,
          ...resolveConversationEmbeddingModelSettings(global, current.override),
        })
    convBindings.value = {
      ...convBindings.value,
      embeddingApi: { ...current, effective },
    }
  })

  watch(
    [
      memoryEnabled,
      memoryTopK,
      () => prefStore.memoryStripPluginBlocks,
      () => prefStore.memoryStripBlockTags,
      () => prefStore.memoryRecallFuseLastAssistant,
      () => prefStore.memoryRecallUserWeight,
    ],
    () => {
      if (!convBindings.value.memory.useGlobal) return
      const global = globalMemoryFromStore()
      convBindings.value = {
        ...convBindings.value,
        memory: {
          useGlobal: true,
          effective: global,
        },
      }
    },
  )

  watch(
    [
      knowledgeEnabled,
      knowledgeTopK,
      knowledgeChunkSizeChars,
      knowledgeChunkOverlapChars,
    ],
    () => {
      if (!convBindings.value.knowledge.useGlobal) return
      const global = globalKnowledgeFromStore()
      convBindings.value = {
        ...convBindings.value,
        knowledge: {
          useGlobal: true,
          effective: global,
        },
      }
    },
  )

  return {
    convBindings,
    bindingsFromIndex,
  }
}
