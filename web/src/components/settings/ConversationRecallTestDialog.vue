<script setup lang="ts">
import {
  fetchContextRecallTest,
  type ContextRecallTestResult,
} from '@/utils/context-recall-test-api'
import { translateApiError } from '@/utils/api-error-message'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  conversationId: string
}>()

const open = defineModel<boolean>({ default: false })

const { t } = useI18n()

const queryText = ref('')
const topK = ref(10)
const simulateTurnOrdinal = ref<number | null>(null)
const submitting = ref(false)
const errorText = ref('')
const result = ref<ContextRecallTestResult | null>(null)
const expandedKey = ref<string | null>(null)

const canSubmit = computed(
  () => !submitting.value && queryText.value.trim().length > 0,
)

function formatScore(score: number | undefined): string {
  if (typeof score !== 'number' || Number.isNaN(score)) return '—'
  return score.toFixed(4)
}

function modeLabel(mode: string, scoreKind?: string): string {
  if (mode === 'vector' && scoreKind === 'vector_fallback') {
    return t('chat.convSettings.recallTestMode.vectorFallback')
  }
  if (mode === 'vector' && scoreKind === 'rrf') {
    return `${t('chat.convSettings.recallTestMode.vector')} · ${t('chat.convSettings.recallTestMode.rrf')}`
  }
  const key = `chat.convSettings.recallTestMode.${mode}`
  return t(key)
}

function memoryItemKey(turnId: string): string {
  return `memory:${turnId}`
}

function loreItemKey(entryId: string): string {
  return `lore:${entryId}`
}

function isExpanded(key: string): boolean {
  return expandedKey.value === key
}

function toggleExpand(key: string): void {
  expandedKey.value = expandedKey.value === key ? null : key
}

function resetForm(): void {
  errorText.value = ''
  result.value = null
  expandedKey.value = null
}

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return
  submitting.value = true
  errorText.value = ''
  result.value = null
  expandedKey.value = null
  try {
    const simRaw = simulateTurnOrdinal.value
    const simulate =
      typeof simRaw === 'number' &&
      Number.isInteger(simRaw) &&
      simRaw >= 0
        ? simRaw
        : undefined
    result.value = await fetchContextRecallTest(
      props.conversationId,
      queryText.value.trim(),
      topK.value,
      simulate,
    )
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    errorText.value = translateApiError(code) || t('chat.convSettings.recallTestFailed')
  } finally {
    submitting.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) {
    resetForm()
    queryText.value = ''
    topK.value = 10
    simulateTurnOrdinal.value = null
  }
})

watch(
  () => props.conversationId,
  () => {
    if (open.value) resetForm()
  },
)
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="56rem"
    scrollable
  >
    <v-card>
      <v-card-title class="text-subtitle-1">
        {{ $t('chat.convSettings.recallTestTitle') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ $t('chat.convSettings.recallTestHint') }}
        </p>

        <div class="recall-test-form">
          <v-textarea
            v-model="queryText"
            :label="$t('chat.convSettings.recallTestQuery')"
            variant="outlined"
            density="comfortable"
            hide-details
            rows="2"
            auto-grow
            class="recall-test-form__query"
            :disabled="submitting"
            @keydown.ctrl.enter.prevent="onSubmit"
          />
          <div class="recall-test-form__actions">
            <v-text-field
              v-model.number="topK"
              type="number"
              min="1"
              max="64"
              step="1"
              :label="$t('chat.convSettings.recallTestTopK')"
              variant="outlined"
              density="compact"
              hide-details
              class="recall-test-form__topk"
              :disabled="submitting"
            />
            <v-text-field
              v-model.number="simulateTurnOrdinal"
              type="number"
              min="0"
              step="1"
              :label="$t('chat.convSettings.recallTestSimulateTurn')"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              class="recall-test-form__simulate"
              :disabled="submitting"
            />
            <v-btn
              color="primary"
              variant="flat"
              class="recall-test-form__submit"
              :loading="submitting"
              :disabled="!canSubmit"
              @click="onSubmit"
            >
              {{ $t('chat.convSettings.recallTestSubmit') }}
            </v-btn>
          </div>
        </div>

        <v-alert
          v-if="errorText"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
        >
          {{ errorText }}
        </v-alert>

        <template v-if="result">
          <p
            v-if="result.loreScanCorpusChars > 0"
            class="text-caption text-medium-emphasis mt-3 mb-0"
          >
            {{ $t('chat.convSettings.recallTestScanCorpusChars', { n: result.loreScanCorpusChars }) }}
          </p>
          <v-alert
            v-if="result.memory.embeddingError"
            type="warning"
            variant="tonal"
            density="compact"
            class="mt-4"
          >
            {{ $t('chat.convSettings.recallTestEmbeddingUnavailable') }}
          </v-alert>

          <div class="recall-test-columns mt-5">
            <section class="recall-test-column">
              <h4 class="text-subtitle-2 mb-2">
                {{ $t('chat.convSettings.recallTestSectionMemory') }}
                <span class="text-caption text-medium-emphasis">
                  ({{ result.memory.hits.length }})
                </span>
              </h4>
              <p
                v-if="result.memory.hits.length === 0"
                class="text-body-2 text-medium-emphasis"
              >
                {{ $t('chat.convSettings.recallTestEmpty') }}
              </p>
              <div
                v-else
                class="recall-test-list"
              >
                <button
                  v-for="(hit, i) in result.memory.hits"
                  :key="hit.turnId"
                  type="button"
                  class="recall-test-list__item"
                  :class="{ 'recall-test-list__item--expanded': isExpanded(memoryItemKey(hit.turnId)) }"
                  @click="toggleExpand(memoryItemKey(hit.turnId))"
                >
                  <div class="recall-test-list__head text-body-2 font-weight-medium">
                    <v-icon
                      :icon="isExpanded(memoryItemKey(hit.turnId)) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                      size="small"
                      class="recall-test-list__chevron"
                    />
                    <span>
                      {{ i + 1 }}.
                      {{ $t('chat.convSettings.recallTestTurnOrdinal', { ord: hit.turnOrdinal }) }}
                      · {{ formatScore(hit.score) }}
                    </span>
                  </div>
                  <div
                    class="recall-test-list__body text-body-2"
                    :class="{ 'recall-test-list__body--clamp': !isExpanded(memoryItemKey(hit.turnId)) }"
                  >
                    {{ isExpanded(memoryItemKey(hit.turnId)) ? hit.content : hit.preview }}
                  </div>
                </button>
              </div>
            </section>

            <section class="recall-test-column">
              <h4 class="text-subtitle-2 mb-2">
                {{ $t('chat.convSettings.recallTestSectionLore') }}
                <span class="text-caption text-medium-emphasis">
                  ({{ result.lore.hits.length }})
                </span>
              </h4>
              <p
                v-if="result.lore.lorebookIds.length === 0"
                class="text-body-2 text-medium-emphasis"
              >
                {{ $t('chat.convSettings.recallTestNoLorebooks') }}
              </p>
              <p
                v-else-if="result.lore.hits.length === 0"
                class="text-body-2 text-medium-emphasis"
              >
                {{ $t('chat.convSettings.recallTestEmpty') }}
              </p>
              <div
                v-else
                class="recall-test-list"
              >
                <button
                  v-for="hit in result.lore.hits"
                  :key="hit.entryId"
                  type="button"
                  class="recall-test-list__item"
                  :class="{ 'recall-test-list__item--expanded': isExpanded(loreItemKey(hit.entryId)) }"
                  @click="toggleExpand(loreItemKey(hit.entryId))"
                >
                  <div class="recall-test-list__head text-body-2 font-weight-medium">
                    <v-icon
                      :icon="isExpanded(loreItemKey(hit.entryId)) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                      size="small"
                      class="recall-test-list__chevron"
                    />
                    <span>
                      {{ hit.lorebookName }} · {{ hit.title }}
                      <span class="text-caption text-medium-emphasis">
                        ({{ modeLabel(hit.mode, hit.scoreKind) }}{{ hit.score != null ? ` · ${formatScore(hit.score)}` : '' }})
                      </span>
                    </span>
                  </div>
                  <div
                    class="recall-test-list__body text-body-2"
                    :class="{ 'recall-test-list__body--clamp': !isExpanded(loreItemKey(hit.entryId)) }"
                  >
                    {{ isExpanded(loreItemKey(hit.entryId)) ? hit.content : hit.preview }}
                  </div>
                </button>
              </div>
            </section>
          </div>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="open = false"
        >
          {{ $t('settings.themeCancel') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.recall-test-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.recall-test-form__query {
  width: 100%;
}

.recall-test-form__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.recall-test-form__topk {
  flex: 0 0 6.5rem;
  width: 6.5rem;
}

.recall-test-form__simulate {
  flex: 0 0 7.5rem;
  width: 7.5rem;
}

.recall-test-form__submit {
  flex: 0 0 auto;
  margin-left: auto;
}

.recall-test-columns {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.recall-test-column {
  flex: 1 1 0;
  min-width: 0;
}

.recall-test-list {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  overflow: hidden;
}

.recall-test-list__item {
  display: block;
  width: 100%;
  padding: 0.5rem 0.625rem;
  text-align: left;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  color: inherit;
  cursor: pointer;
}

.recall-test-list__item:last-child {
  border-bottom: none;
}

.recall-test-list__item:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.recall-test-list__item--expanded {
  background: rgba(var(--v-theme-primary), 0.06);
}

.recall-test-list__head {
  display: flex;
  align-items: flex-start;
  gap: 0.25rem;
}

.recall-test-list__chevron {
  flex-shrink: 0;
  margin-top: 0.125rem;
  opacity: 0.7;
}

.recall-test-list__body {
  margin-top: 0.375rem;
  padding-left: 1.25rem;
  white-space: pre-wrap;
  opacity: 0.88;
  word-break: break-word;
}

.recall-test-list__body--clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
}

@media (max-width: 40rem) {
  .recall-test-columns {
    flex-direction: column;
  }
}
</style>
