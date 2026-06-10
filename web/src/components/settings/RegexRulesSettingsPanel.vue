<script setup lang="ts">
import { useRegexRulesStore } from '@/stores/regex-rules'
import type { RegexField, RegexPhase } from '@/types/regex-rules'
import {
  MAX_REGEX_LABEL_LENGTH,
  MAX_REGEX_PATTERN_LENGTH,
  MAX_REGEX_REPLACEMENT_LENGTH,
  REGEX_FIELD_OPTIONS,
  REGEX_PHASE_OPTIONS,
  validateRegexPatternClient,
} from '@/utils/regex-rules'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const store = useRegexRulesStore()
const {
  sortedRules,
  loading,
  saving,
  lastError,
  selectedRuleId,
  selectedRule,
} = storeToRefs(store)

const dragIndex = ref<number | null>(null)
const deleteOpen = ref(false)
const deleteTargetId = ref<string | null>(null)

const testInput = ref('')
const testPhase = ref<RegexPhase>('display')
const testField = ref<RegexField>('assistant')
const testTurnOrdinal = ref(0)
const testTailOrdinal = ref(100)
const testLoading = ref(false)
const testError = ref('')
const testOutput = ref('')

const patternError = computed(() => {
  const rule = selectedRule.value
  if (!rule) return ''
  const code = validateRegexPatternClient(rule.pattern, rule.flags)
  if (!code) return ''
  return t(`settings.regexRules.validation.${code}`)
})

function phaseTitle(phase: RegexPhase): string {
  return t(`settings.regexRules.phase.${phase}`)
}

function fieldTitle(field: RegexField): string {
  return t(`settings.regexRules.field.${field}`)
}

function onDragStart(index: number) {
  dragIndex.value = index
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

function onDrop(index: number) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from == null || from === index) return
  store.reorderRules(from, index)
}

function openDelete(id: string) {
  deleteTargetId.value = id
  deleteOpen.value = true
}

function confirmDelete() {
  if (deleteTargetId.value) store.deleteRule(deleteTargetId.value)
  deleteOpen.value = false
  deleteTargetId.value = null
}

function cancelDelete() {
  deleteOpen.value = false
  deleteTargetId.value = null
}

async function runTest() {
  const rule = selectedRule.value
  testError.value = ''
  testOutput.value = ''
  if (!rule) return
  const patternErr = validateRegexPatternClient(rule.pattern, rule.flags)
  if (patternErr) {
    testError.value = t(`settings.regexRules.validation.${patternErr}`)
    return
  }
  if (!rule.phases.includes(testPhase.value)) {
    testError.value = t('settings.regexRules.testPhaseMismatch')
    return
  }
  if (!rule.fields.includes(testField.value)) {
    testError.value = t('settings.regexRules.testFieldMismatch')
    return
  }
  const skip = rule.skipLastNTurns
  if (skip > 0) {
    const threshold = Math.max(0, Math.trunc(testTailOrdinal.value)) - skip
    if (Math.max(0, Math.trunc(testTurnOrdinal.value)) > threshold) {
      testError.value = t('settings.regexRules.testSkipMismatch')
      return
    }
  }
  testLoading.value = true
  try {
    const re = new RegExp(rule.pattern, rule.flags)
    testOutput.value = testInput.value.replace(re, rule.replacement)
  } catch {
    testError.value = t('settings.regexRules.validation.invalid_regexp')
  } finally {
    testLoading.value = false
  }
}

watch(selectedRuleId, () => {
  testError.value = ''
  testOutput.value = ''
})
</script>

<template>
  <section class="settings-section regex-rules-panel">
    <h2 class="text-subtitle-1 font-weight-medium mb-2">
      {{ $t('settings.regexRules.section') }}
    </h2>
    <p class="text-body-2 text-medium-emphasis mb-4">
      {{ $t('settings.regexRules.sectionHint') }}
    </p>

    <v-alert
      v-if="lastError"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-3"
    >
      {{ lastError }}
    </v-alert>

    <v-progress-linear
      v-if="loading || saving"
      indeterminate
      color="primary"
      class="mb-3"
    />

    <div class="regex-rules-panel__toolbar mb-3">
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        class="text-none"
        prepend-icon="mdi-plus"
        :disabled="loading"
        @click="store.addRule()"
      >
        {{ $t('settings.regexRules.addRule') }}
      </v-btn>
      <span
        v-if="saving"
        class="text-caption text-medium-emphasis ms-2"
      >
        {{ $t('settings.regexRules.saving') }}
      </span>
    </div>

    <p
      v-if="!loading && sortedRules.length === 0"
      class="text-body-2 text-medium-emphasis mb-4"
    >
      {{ $t('settings.regexRules.empty') }}
    </p>

    <v-list
      v-if="sortedRules.length > 0"
      class="regex-rules-panel__list rounded-lg border mb-4"
      density="comfortable"
    >
      <v-list-item
        v-for="(rule, index) in sortedRules"
        :key="rule.id"
        draggable="true"
        class="regex-rules-panel__list-item"
        :class="{ 'is-selected': selectedRuleId === rule.id }"
        @dragstart="onDragStart(index)"
        @dragover="onDragOver"
        @drop="onDrop(index)"
        @click="store.selectRule(rule.id)"
      >
        <template #prepend>
          <v-icon
            class="regex-rules-panel__drag"
            size="18"
            :title="$t('prompts.dragHandle')"
          >
            mdi-drag-vertical
          </v-icon>
        </template>

        <v-list-item-title class="font-weight-medium">
          {{ rule.label.trim() || $t('settings.regexRules.untitled') }}
        </v-list-item-title>
        <v-list-item-subtitle class="text-caption">
          {{ rule.pattern || $t('settings.regexRules.noPattern') }}
        </v-list-item-subtitle>

        <template #append>
          <div
            class="regex-rules-panel__row-actions"
            @click.stop
          >
            <v-switch
              :model-value="rule.enabled"
              color="primary"
              density="compact"
              hide-details
              :aria-label="$t('settings.regexRules.enabledAria', {
                name: rule.label.trim() || rule.id,
              })"
              @update:model-value="store.setRuleEnabled(rule.id, $event ?? false)"
            />
            <v-tooltip
              location="top"
              :text="$t('settings.regexRules.deleteRule')"
            >
              <template #activator="{ props: tooltipProps }">
                <v-icon-btn
                  v-bind="tooltipProps"
                  icon="mdi-delete-outline"
                  variant="text"
                  color="error"
                  size="small"
                  :icon-size="22"
                  @click="openDelete(rule.id)"
                />
              </template>
            </v-tooltip>
          </div>
        </template>
      </v-list-item>
    </v-list>

    <v-sheet
      v-if="selectedRule"
      rounded="lg"
      border
      class="pa-4 regex-rules-panel__editor"
    >
      <h3 class="text-body-1 font-weight-medium mb-3">
        {{ $t('settings.regexRules.editorTitle') }}
      </h3>

      <v-text-field
        :model-value="selectedRule.label"
        :label="$t('settings.regexRules.label')"
        :maxlength="MAX_REGEX_LABEL_LENGTH"
        density="comfortable"
        variant="outlined"
        hide-details="auto"
        class="mb-3"
        @update:model-value="store.patchRule(selectedRule.id, { label: String($event ?? '') })"
      />

      <v-text-field
        :model-value="selectedRule.pattern"
        :label="$t('settings.regexRules.pattern')"
        :maxlength="MAX_REGEX_PATTERN_LENGTH"
        density="comfortable"
        variant="outlined"
        :error-messages="patternError ? [patternError] : []"
        hide-details="auto"
        class="mb-3"
        @update:model-value="store.patchRule(selectedRule.id, { pattern: String($event ?? '') })"
      />

      <div class="regex-rules-panel__row mb-3">
        <v-text-field
          :model-value="selectedRule.flags"
          :label="$t('settings.regexRules.flags')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          class="regex-rules-panel__flags"
          @update:model-value="store.patchRule(selectedRule.id, { flags: String($event ?? '') })"
        />
        <v-text-field
          :model-value="selectedRule.replacement"
          :label="$t('settings.regexRules.replacement')"
          :maxlength="MAX_REGEX_REPLACEMENT_LENGTH"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          class="regex-rules-panel__replacement"
          @update:model-value="store.patchRule(selectedRule.id, { replacement: String($event ?? '') })"
        />
      </div>

      <v-select
        :model-value="selectedRule.phases"
        :items="REGEX_PHASE_OPTIONS"
        :label="$t('settings.regexRules.phases')"
        item-title="value"
        item-value="value"
        multiple
        chips
        closable-chips
        density="comfortable"
        variant="outlined"
        hide-details="auto"
        class="mb-3"
        @update:model-value="store.patchRule(selectedRule.id, { phases: $event as RegexPhase[] })"
      >
        <template #chip="{ item }">
          <v-chip size="small">
            {{ phaseTitle(item.value as RegexPhase) }}
          </v-chip>
        </template>
        <template #item="{ props: itemProps, item }">
          <v-list-item
            v-bind="itemProps"
            :title="phaseTitle(item.value as RegexPhase)"
          />
        </template>
      </v-select>

      <v-select
        :model-value="selectedRule.fields"
        :items="REGEX_FIELD_OPTIONS"
        :label="$t('settings.regexRules.fields')"
        item-title="value"
        item-value="value"
        multiple
        chips
        closable-chips
        density="comfortable"
        variant="outlined"
        hide-details="auto"
        class="mb-3"
        @update:model-value="store.patchRule(selectedRule.id, { fields: $event as RegexField[] })"
      >
        <template #chip="{ item }">
          <v-chip size="small">
            {{ fieldTitle(item.value as RegexField) }}
          </v-chip>
        </template>
        <template #item="{ props: itemProps, item }">
          <v-list-item
            v-bind="itemProps"
            :title="fieldTitle(item.value as RegexField)"
          />
        </template>
      </v-select>

      <v-text-field
        :model-value="selectedRule.skipLastNTurns"
        type="number"
        min="0"
        step="1"
        :label="$t('settings.regexRules.skipLastNTurns')"
        :hint="$t('settings.regexRules.skipLastNTurnsHint')"
        persistent-hint
        density="comfortable"
        variant="outlined"
        hide-details="auto"
        class="mb-4"
        @update:model-value="store.patchRule(selectedRule.id, {
          skipLastNTurns: Math.max(0, Math.trunc(Number($event) || 0)),
        })"
      />

      <v-divider class="mb-4" />

      <h4 class="text-body-2 font-weight-medium mb-2">
        {{ $t('settings.regexRules.testTitle') }}
      </h4>
      <p class="text-caption text-medium-emphasis mb-3">
        {{ $t('settings.regexRules.testHint') }}
      </p>

      <v-textarea
        v-model="testInput"
        :label="$t('settings.regexRules.testInput')"
        rows="3"
        auto-grow
        density="comfortable"
        variant="outlined"
        hide-details="auto"
        class="mb-3"
      />

      <div class="regex-rules-panel__test-row mb-3">
        <v-select
          v-model="testPhase"
          :items="REGEX_PHASE_OPTIONS"
          :label="$t('settings.regexRules.testPhase')"
          item-title="value"
          item-value="value"
          density="compact"
          variant="outlined"
          hide-details
        >
          <template #selection="{ item }">
            {{ phaseTitle(item.value as RegexPhase) }}
          </template>
          <template #item="{ props: itemProps, item }">
            <v-list-item
              v-bind="itemProps"
              :title="phaseTitle(item.value as RegexPhase)"
            />
          </template>
        </v-select>
        <v-select
          v-model="testField"
          :items="REGEX_FIELD_OPTIONS"
          :label="$t('settings.regexRules.testField')"
          item-title="value"
          item-value="value"
          density="compact"
          variant="outlined"
          hide-details
        >
          <template #selection="{ item }">
            {{ fieldTitle(item.value as RegexField) }}
          </template>
          <template #item="{ props: itemProps, item }">
            <v-list-item
              v-bind="itemProps"
              :title="fieldTitle(item.value as RegexField)"
            />
          </template>
        </v-select>
        <v-text-field
          v-model.number="testTurnOrdinal"
          type="number"
          min="0"
          :label="$t('settings.regexRules.testTurnOrdinal')"
          density="compact"
          variant="outlined"
          hide-details
        />
        <v-text-field
          v-model.number="testTailOrdinal"
          type="number"
          min="0"
          :label="$t('settings.regexRules.testTailOrdinal')"
          density="compact"
          variant="outlined"
          hide-details
        />
      </div>

      <v-btn
        color="primary"
        variant="tonal"
        size="small"
        class="text-none mb-3"
        :loading="testLoading"
        @click="runTest"
      >
        {{ $t('settings.regexRules.testRun') }}
      </v-btn>

      <v-alert
        v-if="testError"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        {{ testError }}
      </v-alert>

      <v-textarea
        v-if="testOutput || testLoading"
        :model-value="testOutput"
        :label="$t('settings.regexRules.testOutput')"
        rows="3"
        auto-grow
        readonly
        density="comfortable"
        variant="outlined"
        hide-details
        :loading="testLoading"
      />
    </v-sheet>

    <v-dialog
      v-model="deleteOpen"
      max-width="400"
    >
      <v-card>
        <v-card-title class="text-h6">
          {{ $t('settings.regexRules.deleteConfirmTitle') }}
        </v-card-title>
        <v-card-text>
          {{ $t('settings.regexRules.deleteConfirmBody') }}
        </v-card-text>
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn
            variant="tonal"
            size="small"
            class="text-none"
            @click="cancelDelete"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            size="small"
            @click="confirmDelete"
          >
            {{ $t('settings.regexRules.deleteRule') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.regex-rules-panel__list {
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}

.regex-rules-panel__list-item {
  cursor: pointer;
}

.regex-rules-panel__list-item.is-selected {
  background: rgba(var(--v-theme-primary), 0.08);
}

.regex-rules-panel__drag {
  opacity: 0.45;
  margin-inline-end: 0.25rem;
  cursor: grab;
}

.regex-rules-panel__row-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.regex-rules-panel__row {
  display: grid;
  grid-template-columns: minmax(5rem, 7rem) 1fr;
  gap: 0.75rem;
}

.regex-rules-panel__test-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (max-width: 600px) {
  .regex-rules-panel__row,
  .regex-rules-panel__test-row {
    grid-template-columns: 1fr;
  }
}
</style>
