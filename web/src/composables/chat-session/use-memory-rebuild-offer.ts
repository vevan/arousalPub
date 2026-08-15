import {
  type MemoryRebuildApi,
} from '@/composables/useMemoryRebuild'
import {
  formatHybridFtsSpec,
} from '@/utils/hybrid-fts-settings'
import { usePreferencesStore } from '@/stores/preferences'
import { storeToRefs } from 'pinia'
import { computed, ref, watch, type Ref } from 'vue'
import type { ConvContextBindings } from './conv-bindings-types'
import { memoryIndexMatchesEffectiveSettings } from '@/utils/memory-index-settings'

export function useMemoryRebuildOffer(opts: {
  getConversationId: () => string
  convBindings: Ref<ConvContextBindings>
  hasConversationTurns: Ref<boolean>
  loading: Ref<boolean>
  /** Shared rebuild instance (required — one per chat view). */
  memoryRebuild: MemoryRebuildApi
}) {
  const prefStore = usePreferencesStore()
  const {
    embeddingModel,
    embeddingDimensions,
  } = storeToRefs(prefStore)

  const effectiveHybridFtsSettings = computed(
    () => opts.convBindings.value.memoryHybridFts.effective,
  )
  const effectiveHybridFtsSpec = computed(() =>
    formatHybridFtsSpec(effectiveHybridFtsSettings.value),
  )

  const conversationMemoryEmbeddingModel = ref<string | null>(null)
  const conversationMemoryEmbeddingDimensions = ref<number | null>(null)
  const conversationMemoryEmbeddingProfile = ref<string | null>(null)
  const conversationMemoryHybridFtsSpec = ref<string | null>(null)
  const memoryRebuildDialogOpen = ref(false)
  let memoryRebuildDismissKey = ''

  const memoryRebuild = opts.memoryRebuild
  const {
    loading: memoryRebuildLoading,
    error: memoryRebuildError,
    done: memoryRebuildDone,
    total: memoryRebuildTotal,
    turns: memoryRebuildTurns,
    loreEntries: memoryRebuildLoreEntries,
    stageLabel: memoryRebuildStageLabel,
    percent: memoryRebuildPercent,
    rebuild: rebuildMemoryIndex,
    abort: abortMemoryRebuild,
  } = memoryRebuild

  function memoryRebuildDismissToken(
    storedModel: string | null,
    activeModel: string,
    storedDims: number | null,
    activeDims: number | null,
    storedProfile: string | null,
    activeProfile: string,
    storedFtsSpec: string | null,
    effectiveFtsSpec: string,
  ): string {
    return [
      storedModel ?? '',
      activeModel,
      storedDims ?? '',
      activeDims ?? '',
      storedProfile ?? '',
      activeProfile,
      storedFtsSpec ?? '',
      effectiveFtsSpec,
    ].join('|')
  }

  function shouldOfferMemoryRebuild(): boolean {
    if (!opts.hasConversationTurns.value) return false
    if (!opts.convBindings.value.memory.effective.memoryEnabled) return false
    const effectiveEmbedding = opts.convBindings.value.embeddingApi.effective
    if (!effectiveEmbedding.embeddingModel.trim()) return false
    const storedModel = conversationMemoryEmbeddingModel.value
    const storedDims = conversationMemoryEmbeddingDimensions.value
    if (!storedModel) return false
    const indexMatches = memoryIndexMatchesEffectiveSettings(
      {
        embeddingProfile: conversationMemoryEmbeddingProfile.value,
        embeddingModel: storedModel,
        embeddingDimensions: storedDims,
      },
      effectiveEmbedding,
      conversationMemoryHybridFtsSpec.value,
      effectiveHybridFtsSettings.value,
    )
    if (indexMatches) {
      return false
    }
    const token = memoryRebuildDismissToken(
      storedModel,
      effectiveEmbedding.embeddingModel,
      storedDims,
      effectiveEmbedding.embeddingDimensions,
      conversationMemoryEmbeddingProfile.value,
      effectiveEmbedding.embeddingProfile,
      conversationMemoryHybridFtsSpec.value,
      effectiveHybridFtsSpec.value,
    )
    if (memoryRebuildDismissKey === token) return false
    return true
  }

  function maybePromptMemoryRebuild(): void {
    if (shouldOfferMemoryRebuild()) {
      memoryRebuildError.value = ''
      memoryRebuildDialogOpen.value = true
    }
  }

  function openMemoryRebuildDialog(): void {
    memoryRebuildError.value = ''
    memoryRebuildDialogOpen.value = true
  }

  function dismissMemoryRebuild(): void {
    const effectiveEmbedding = opts.convBindings.value.embeddingApi.effective
    memoryRebuildDismissKey = memoryRebuildDismissToken(
      conversationMemoryEmbeddingModel.value,
      effectiveEmbedding.embeddingModel,
      conversationMemoryEmbeddingDimensions.value,
      effectiveEmbedding.embeddingDimensions,
      conversationMemoryEmbeddingProfile.value,
      effectiveEmbedding.embeddingProfile,
      conversationMemoryHybridFtsSpec.value,
      effectiveHybridFtsSpec.value,
    )
    memoryRebuildDialogOpen.value = false
    memoryRebuildError.value = ''
  }

  async function confirmMemoryRebuild(): Promise<void> {
    const result = await rebuildMemoryIndex()
    if (!result) return
    conversationMemoryEmbeddingModel.value = result.embeddingModel
    conversationMemoryEmbeddingDimensions.value =
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions
    conversationMemoryEmbeddingProfile.value =
      opts.convBindings.value.embeddingApi.effective.embeddingProfile
    conversationMemoryHybridFtsSpec.value = result.hybridFtsSpec
    memoryRebuildDismissKey = memoryRebuildDismissToken(
      result.embeddingModel,
      opts.convBindings.value.embeddingApi.effective.embeddingModel,
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions,
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions,
      opts.convBindings.value.embeddingApi.effective.embeddingProfile,
      opts.convBindings.value.embeddingApi.effective.embeddingProfile,
      result.hybridFtsSpec,
      effectiveHybridFtsSpec.value,
    )
    memoryRebuildDialogOpen.value = false
  }

  function onMemoryRebuiltFromSettings(result: {
    embeddingModel: string
    hybridFtsSpec: string
  }): void {
    conversationMemoryEmbeddingModel.value = result.embeddingModel
    conversationMemoryEmbeddingDimensions.value =
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions
    conversationMemoryEmbeddingProfile.value =
      opts.convBindings.value.embeddingApi.effective.embeddingProfile
    conversationMemoryHybridFtsSpec.value = result.hybridFtsSpec
    memoryRebuildDismissKey = memoryRebuildDismissToken(
      result.embeddingModel,
      opts.convBindings.value.embeddingApi.effective.embeddingModel,
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions,
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions,
      opts.convBindings.value.embeddingApi.effective.embeddingProfile,
      opts.convBindings.value.embeddingApi.effective.embeddingProfile,
      result.hybridFtsSpec,
      effectiveHybridFtsSpec.value,
    )
    memoryRebuildDialogOpen.value = false
  }

  function applyConversationMemoryIndexMeta(index: Record<string, unknown>): void {
    const memModel = index.memoryEmbeddingModel
    conversationMemoryEmbeddingModel.value =
      typeof memModel === 'string' && memModel.trim() ? memModel.trim() : null
    const memDims = index.memoryEmbeddingDimensions
    conversationMemoryEmbeddingDimensions.value =
      typeof memDims === 'number' && Number.isFinite(memDims) && memDims > 0
        ? Math.floor(memDims)
        : null
    const memProfile = index.memoryEmbeddingProfile
    conversationMemoryEmbeddingProfile.value =
      typeof memProfile === 'string' && memProfile.trim() ? memProfile.trim() : null
    const memFts = index.memoryHybridFtsProfile
    conversationMemoryHybridFtsSpec.value =
      typeof memFts === 'string' && memFts.trim() ? memFts.trim() : null
  }

  function resetMemoryRebuildOffer(): void {
    abortMemoryRebuild()
    memoryRebuildDismissKey = ''
    memoryRebuildDialogOpen.value = false
    memoryRebuildError.value = ''
  }

  watch(
    [
      () => opts.convBindings.value.embeddingApi.effective.embeddingProfile,
      effectiveHybridFtsSpec,
      embeddingModel,
      embeddingDimensions,
    ],
    () => {
      if (opts.loading.value) return
      maybePromptMemoryRebuild()
    },
  )

  watch(
    () => opts.convBindings.value.memory.effective.memoryEnabled,
    () => {
      if (opts.loading.value) return
      maybePromptMemoryRebuild()
    },
  )

  return {
    memoryRebuild,
    effectiveHybridFtsSpec,
    conversationMemoryEmbeddingModel,
    conversationMemoryEmbeddingDimensions,
    conversationMemoryEmbeddingProfile,
    conversationMemoryHybridFtsSpec,
    memoryRebuildDialogOpen,
    memoryRebuildLoading,
    memoryRebuildError,
    memoryRebuildDone,
    memoryRebuildTotal,
    memoryRebuildTurns,
    memoryRebuildLoreEntries,
    memoryRebuildStageLabel,
    memoryRebuildPercent,
    maybePromptMemoryRebuild,
    openMemoryRebuildDialog,
    dismissMemoryRebuild,
    confirmMemoryRebuild,
    onMemoryRebuiltFromSettings,
    applyConversationMemoryIndexMeta,
    resetMemoryRebuildOffer,
  }
}
