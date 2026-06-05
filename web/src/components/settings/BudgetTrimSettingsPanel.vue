<script setup lang="ts">
import {
  BUDGET_TRIM_SETTINGS_DEFAULTS,
  cloneBudgetTrimSettings,
  normalizeBudgetTrimSettings,
  type BudgetTrimSettings,
  type BudgetTrimSlot,
} from '@/utils/budget-trim-settings'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: BudgetTrimSettings
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: BudgetTrimSettings): void
}>()

const { t } = useI18n()
const dragIndex = ref<number | null>(null)

const normalized = computed(() => normalizeBudgetTrimSettings(props.modelValue))

const rows = computed(() =>
  normalized.value.trimOrder.map((slot) => ({
    slot,
    minRetain: normalized.value.minRetain[slot],
  })),
)

function emitSettings(next: BudgetTrimSettings) {
  emit('update:modelValue', normalizeBudgetTrimSettings(next))
}

function onMinRetainChange(slot: BudgetTrimSlot, raw: unknown) {
  const num = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(num)) return
  const clamped = Math.max(0, Math.min(32, Math.floor(num)))
  if (normalized.value.minRetain[slot] === clamped) return
  const base = cloneBudgetTrimSettings(normalized.value)
  base.minRetain[slot] = clamped
  emitSettings(base)
}

function onDragStart(index: number) {
  if (props.disabled) return
  dragIndex.value = index
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

function onDrop(index: number) {
  if (props.disabled) return
  const from = dragIndex.value
  dragIndex.value = null
  if (from == null || from === index) return
  const base = cloneBudgetTrimSettings(normalized.value)
  const order = base.trimOrder.slice()
  const [item] = order.splice(from, 1)
  if (!item) return
  order.splice(index, 0, item)
  base.trimOrder = order
  emitSettings(base)
}

function slotLabel(slot: BudgetTrimSlot): string {
  return t(`settings.budgetTrimSlot.${slot}`)
}
</script>

<template>
  <div class="budget-trim-panel">
    <p class="budget-trim-panel__hint text-body-2 text-medium-emphasis mb-3">
      {{ $t('settings.budgetTrimOrderHint') }}
    </p>
    <ul class="budget-trim-panel__list">
      <li
        v-for="(row, index) in rows"
        :key="row.slot"
        class="budget-trim-panel__row"
        :class="{ 'is-dragging': dragIndex === index }"
        draggable="true"
        @dragstart="onDragStart(index)"
        @dragover="onDragOver"
        @drop="onDrop(index)"
      >
        <v-icon
          size="16"
          class="budget-trim-panel__handle"
          :title="$t('prompts.dragHandle')"
        >
          mdi-drag-vertical
        </v-icon>
        <span class="budget-trim-panel__label">{{ slotLabel(row.slot) }}</span>
        <v-text-field
          :model-value="row.minRetain"
          type="number"
          :min="0"
          :max="32"
          step="1"
          density="compact"
          variant="outlined"
          hide-details="auto"
          class="budget-trim-panel__retain"
          :label="$t('settings.budgetTrimMinRetain')"
          :disabled="disabled"
          @update:model-value="(v) => onMinRetainChange(row.slot, v)"
        />
      </li>
    </ul>
    <p class="budget-trim-panel__foot text-caption text-medium-emphasis mb-0">
      {{ $t('settings.budgetTrimDefaultsNote', {
        lore: BUDGET_TRIM_SETTINGS_DEFAULTS.minRetain.lore,
        memory: BUDGET_TRIM_SETTINGS_DEFAULTS.minRetain.memory,
        history: BUDGET_TRIM_SETTINGS_DEFAULTS.minRetain.history,
      }) }}
    </p>
  </div>
</template>

<style scoped>
.budget-trim-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.budget-trim-panel__row {
  display: grid;
  grid-template-columns: auto 1fr minmax(7rem, 9rem);
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.625rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 0.5rem;
  background: rgba(var(--v-theme-on-surface), 0.02);
}

.budget-trim-panel__row.is-dragging {
  opacity: 0.55;
}

.budget-trim-panel__handle {
  cursor: grab;
  opacity: 0.45;
}

.budget-trim-panel__label {
  font-size: 0.875rem;
}
</style>
