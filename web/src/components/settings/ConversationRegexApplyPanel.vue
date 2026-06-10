<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useRegexRulesDisplayStore } from '@/stores/regex-rules-display'
import type { RegexField, RegexPhase, RegexRule } from '@/types/regex-rules'
import { translateApiError } from '@/utils/api-error-message'
import { fetchConversationTurns } from '@/utils/chat-messages'
import { sortRegexRules } from '@/utils/regex-rules'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

export interface RegexBatchApplyResult {
  dryRun: boolean
  fromOrdinal: number
  toOrdinal: number
  turnCount: number
  changedTurnCount: number
  ok?: number
  failed?: { turnOrdinal: number; error: string }[]
  memoryReindexRecommended: boolean
}

const props = defineProps<{
  conversationId: string
}>()

const emit = defineEmits<{
  (e: 'applied'): void
}>()

const { t } = useI18n()
const auth = useAuthStore()
const rulesStore = useRegexRulesDisplayStore()
const { rules: allRules } = storeToRefs(rulesStore)

const loadingTurns = ref(false)
const maxTurnOrdinal = ref(0)
const fromOrdinal = ref(0)
const toOrdinal = ref(0)
const selectedRuleIds = ref<string[]>([])
const applying = ref(false)
const errorText = ref('')
const lastResult = ref<RegexBatchApplyResult | null>(null)

const persistRules = computed(() =>
  sortRegexRules(
    allRules.value.filter(
      (r) => r.enabled && r.phases.includes('persist'),
    ),
  ),
)

const hasPersistRules = computed(() => persistRules.value.length > 0)

const canSubmit = computed(
  () =>
    !loadingTurns.value &&
    !applying.value &&
    hasPersistRules.value &&
    selectedRuleIds.value.length > 0 &&
    fromOrdinal.value >= 0 &&
    toOrdinal.value >= fromOrdinal.value,
)

function phaseTitle(phase: RegexPhase): string {
  return t(`settings.regexRules.phase.${phase}`)
}

function fieldTitle(field: RegexField): string {
  return t(`settings.regexRules.field.${field}`)
}

function ruleTitle(rule: RegexRule): string {
  const label = rule.label.trim()
  return label || t('settings.regexRules.untitled')
}

async function ensureContextLoaded(): Promise<void> {
  errorText.value = ''
  const uid = auth.user?.id ?? auth.defaultUserId ?? undefined
  if (uid) {
    await rulesStore.ensureLoaded(uid)
  }
  loadingTurns.value = true
  try {
    const turns = await fetchConversationTurns(props.conversationId)
    maxTurnOrdinal.value = turns.length
      ? Math.max(...turns.map((row) => row.turnOrdinal))
      : 0
    fromOrdinal.value = 0
    toOrdinal.value = maxTurnOrdinal.value
  } catch {
    errorText.value = t('chat.convSettings.regexApplyLoadFailed')
  } finally {
    loadingTurns.value = false
  }
}

async function runBatch(dryRun: boolean): Promise<void> {
  if (!canSubmit.value) return
  applying.value = true
  errorText.value = ''
  lastResult.value = null
  try {
    const res = await fetch(
      `/api/chat/conversations/${encodeURIComponent(props.conversationId)}/regex/apply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun,
          fromOrdinal: fromOrdinal.value,
          toOrdinal: toOrdinal.value,
          ruleIds: selectedRuleIds.value,
        }),
      },
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      errorText.value = translateApiError(body?.error ?? '')
      return
    }
    const result = (await res.json()) as RegexBatchApplyResult
    lastResult.value = result
    if (!dryRun && result.changedTurnCount > 0) {
      emit('applied')
    }
  } catch {
    errorText.value = t('chat.convSettings.regexApplyFailed')
  } finally {
    applying.value = false
  }
}

watch(
  () => props.conversationId,
  () => {
    selectedRuleIds.value = []
    lastResult.value = null
    void ensureContextLoaded()
  },
  { immediate: true },
)

defineExpose({ reload: ensureContextLoaded })
</script>

<template>
  <div class="conv-regex-apply">
    <p class="conv-settings-field__hint mb-4">
      {{ $t('chat.convSettings.regexApplyHint') }}
    </p>

    <v-alert
      v-if="!loadingTurns && !hasPersistRules"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      {{ $t('chat.convSettings.regexApplyNoPersistRules') }}
    </v-alert>

    <div
      v-if="hasPersistRules"
      class="conv-settings-field conv-regex-apply__range"
    >
      <div class="conv-regex-apply__range-fields">
        <v-text-field
          v-model.number="fromOrdinal"
          type="number"
          min="0"
          :max="maxTurnOrdinal"
          step="1"
          :label="$t('chat.convSettings.regexApplyFromOrdinal')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          :disabled="loadingTurns || applying"
          class="conv-regex-apply__range-input"
        />
        <v-text-field
          v-model.number="toOrdinal"
          type="number"
          min="0"
          :max="maxTurnOrdinal"
          step="1"
          :label="$t('chat.convSettings.regexApplyToOrdinal')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          :disabled="loadingTurns || applying"
          class="conv-regex-apply__range-input"
        />
      </div>
      <p class="conv-regex-apply__range-hint">
        {{
          $t('chat.convSettings.regexApplyOrdinalHint', {
            max: maxTurnOrdinal,
          })
        }}
      </p>
    </div>

    <v-progress-linear
      v-if="loadingTurns"
      indeterminate
      color="primary"
      class="mb-4"
    />

    <div
      v-if="hasPersistRules && !loadingTurns"
      class="conv-regex-apply__rules mb-4"
    >
      <p class="text-body-2 font-weight-medium mb-2">
        {{ $t('chat.convSettings.regexApplyRulesTitle') }}
      </p>
      <v-expansion-panels
        variant="accordion"
        density="compact"
      >
        <v-expansion-panel
          v-for="rule in persistRules"
          :key="rule.id"
          :title="ruleTitle(rule)"
        >
          <template #title>
            <div class="d-flex align-center gap-2 conv-regex-apply__rule-title">
              <v-checkbox
                :model-value="selectedRuleIds.includes(rule.id)"
                density="compact"
                hide-details
                color="primary"
                :disabled="applying"
                @click.stop
                @update:model-value="
                  (v) => {
                    if (v) {
                      if (!selectedRuleIds.includes(rule.id)) {
                        selectedRuleIds.push(rule.id)
                      }
                    } else {
                      selectedRuleIds = selectedRuleIds.filter((id) => id !== rule.id)
                    }
                  }
                "
              />
              <span>{{ ruleTitle(rule) }}</span>
            </div>
          </template>
          <v-expansion-panel-text>
            <dl class="conv-regex-apply__detail">
              <dt>{{ $t('settings.regexRules.pattern') }}</dt>
              <dd><code>{{ rule.pattern || $t('settings.regexRules.noPattern') }}</code></dd>
              <dt>{{ $t('settings.regexRules.flagsLiteral') }}</dt>
              <dd><code>{{ rule.flags || '—' }}</code></dd>
              <dt>{{ $t('settings.regexRules.replacement') }}</dt>
              <dd>
                <code v-if="rule.replacement">{{ rule.replacement }}</code>
                <span v-else class="text-medium-emphasis">
                  {{ $t('settings.regexRules.replacementEmptyHint') }}
                </span>
              </dd>
              <dt>{{ $t('settings.regexRules.phases') }}</dt>
              <dd>
                <v-chip
                  v-for="p in rule.phases"
                  :key="p"
                  size="x-small"
                  class="mr-1"
                  variant="tonal"
                >
                  {{ phaseTitle(p) }}
                </v-chip>
              </dd>
              <dt>{{ $t('settings.regexRules.fields') }}</dt>
              <dd>
                <v-chip
                  v-for="f in rule.fields"
                  :key="f"
                  size="x-small"
                  class="mr-1"
                  variant="tonal"
                >
                  {{ fieldTitle(f) }}
                </v-chip>
              </dd>
              <dt>{{ $t('settings.regexRules.skipLastNTurns') }}</dt>
              <dd>{{ rule.skipLastNTurns }}</dd>
            </dl>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </div>

    <v-alert
      v-if="errorText"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      {{ errorText }}
    </v-alert>

    <v-alert
      v-if="lastResult"
      :type="lastResult.changedTurnCount > 0 ? 'warning' : 'info'"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      <div>
        {{
          lastResult.dryRun
            ? $t('chat.convSettings.regexApplyDryRunResult', {
                changed: lastResult.changedTurnCount,
                total: lastResult.turnCount,
              })
            : $t('chat.convSettings.regexApplyResult', {
                changed: lastResult.changedTurnCount,
                total: lastResult.turnCount,
              })
        }}
      </div>
      <div
        v-if="lastResult.memoryReindexRecommended"
        class="text-caption mt-1"
      >
        {{ $t('chat.convSettings.regexApplyMemoryHint') }}
      </div>
    </v-alert>

    <div
      v-if="hasPersistRules"
      class="conv-regex-apply__actions"
    >
      <v-btn
        variant="outlined"
        color="primary"
        :disabled="!canSubmit"
        :loading="applying"
        @click="runBatch(true)"
      >
        {{ $t('chat.convSettings.regexApplyDryRun') }}
      </v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :disabled="!canSubmit"
        :loading="applying"
        @click="runBatch(false)"
      >
        {{ $t('chat.convSettings.regexApplyRun') }}
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.conv-regex-apply__range {
  margin-bottom: 1.25rem;
}

.conv-regex-apply__range-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 1rem 1.5rem;
}

.conv-regex-apply__range-input {
  flex: 0 1 7.5rem;
  min-width: 6.5rem;
  max-width: 9rem;
}

.conv-regex-apply__range-hint {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.58);
}

.conv-regex-apply__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.875rem;
  margin-top: 0.25rem;
  padding-top: 0.625rem;
}

.conv-regex-apply__rule-title {
  min-width: 0;
  flex: 1 1 auto;
}

.conv-regex-apply__detail {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 0.75rem;
  margin: 0;
  font-size: 0.8125rem;
}

.conv-regex-apply__detail dt {
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.conv-regex-apply__detail dd {
  margin: 0;
  word-break: break-word;
}

.conv-regex-apply__detail code {
  font-size: 0.75rem;
}
</style>
