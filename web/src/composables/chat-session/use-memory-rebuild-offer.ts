import {
  type MemoryRebuildApi,
} from '@/composables/useMemoryRebuild'
import {
  formatHybridFtsSpec,
  normalizeHybridFtsSettings,
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
    hybridFtsProfile,
    hybridFtsDictVariant,
  } = storeToRefs(prefStore)

  const globalHybridFtsSettings = computed(() =>
    normalizeHybridFtsSettings({
      profile: hybridFtsProfile.value,
      dictVariant: hybridFtsDictVariant.value,
    }),
  )
  const globalHybridFtsSpec = computed(() =>
    formatHybridFtsSpec(globalHybridFtsSettings.value),
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
    globalFtsSpec: string,
  ): string {
    return [
      storedModel ?? '',
      activeModel,
      storedDims ?? '',
      activeDims ?? '',
      storedProfile ?? '',
      activeProfile,
      storedFtsSpec ?? '',
      globalFtsSpec,
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
      globalHybridFtsSettings.value,
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
      globalHybridFtsSpec.value,
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
      globalHybridFtsSpec.value,
    )
    memoryRebuildDialogOpen.value = false
    memoryRebuildError.value = ''
  }

  async function confirmMemoryRebuild(): Promise<void> {
    const nextModel = await rebuildMemoryIndex()
    if (!nextModel) return
    conversationMemoryEmbeddingModel.value = nextModel
    conversationMemoryEmbeddingDimensions.value =
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions
    conversationMemoryEmbeddingProfile.value =
      opts.convBindings.value.embeddingApi.effective.embeddingProfile
    conversationMemoryHybridFtsSpec.value = globalHybridFtsSpec.value
    memoryRebuildDismissKey = memoryRebuildDismissToken(
      nextModel,
      opts.convBindings.value.embeddingApi.effective.embeddingModel,
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions,
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions,
      opts.convBindings.value.embeddingApi.effective.embeddingProfile,
      opts.convBindings.value.embeddingApi.effective.embeddingProfile,
      globalHybridFtsSpec.value,
      globalHybridFtsSpec.value,
    )
    memoryRebuildDialogOpen.value = false
  }

  function onMemoryRebuiltFromSettings(model: string): void {
    conversationMemoryEmbeddingModel.value = model
    conversationMemoryEmbeddingDimensions.value =
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions
    conversationMemoryEmbeddingProfile.value =
      opts.convBindings.value.embeddingApi.effective.embeddingProfile
    conversationMemoryHybridFtsSpec.value = globalHybridFtsSpec.value
    memoryRebuildDismissKey = memoryRebuildDismissToken(
      model,
      opts.convBindings.value.embeddingApi.effective.embeddingModel,
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions,
      opts.convBindings.value.embeddingApi.effective.embeddingDimensions,
      opts.convBindings.value.embeddingApi.effective.embeddingProfile,
      opts.convBindings.value.embeddingApi.effective.embeddingProfile,
      globalHybridFtsSpec.value,
      globalHybridFtsSpec.value,
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
      embeddingModel,
      embeddingDimensions,
      hybridFtsProfile,
      hybridFtsDictVariant,
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
    globalHybridFtsSpec,
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
