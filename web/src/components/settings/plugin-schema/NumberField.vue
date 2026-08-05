<script setup lang="ts">
import type { PluginSettingsFieldSchema } from '@/plugins/plugin-settings-types'
import { usePluginSchemaFormApi } from '@/components/settings/plugin-schema/injection'

defineProps<{
  field: PluginSettingsFieldSchema
}>()

const form = usePluginSchemaFormApi()
</script>

<template>
  <div
    v-if="
      field.widget === 'slider' &&
      (field.type === 'integer' || field.type === 'number')
    "
  >
    <div class="text-body-2 font-weight-medium mb-1">
      {{ form.labelFor(field) }}
    </div>
    <p
      v-if="form.hintFor(field)"
      class="text-caption text-medium-emphasis mb-2"
    >
      {{ form.hintFor(field) }}
    </p>
    <div class="d-flex align-center ga-4">
      <v-slider
        :model-value="form.sliderValue(field)"
        :min="field.min ?? 0"
        :max="field.max ?? 1"
        :step="form.sliderStep(field)"
        color="primary"
        class="flex-grow-1"
        hide-details
        @update:model-value="form.setField(field.key, $event)"
      />
      <span class="text-body-2 font-mono plugin-slider-readout">
        {{ form.sliderReadout(field) }}
      </span>
    </div>
  </div>

  <v-text-field
    v-else-if="
      field.conversationInherit &&
      (field.type === 'integer' || field.type === 'number')
    "
    :model-value="form.inheritNumberDisplay(field)"
    type="number"
    :label="form.labelFor(field)"
    :hint="form.fullHintFor(field)"
    persistent-hint
    variant="outlined"
    density="compact"
    hide-details="auto"
    clearable
    :min="field.min"
    :max="field.max"
    :step="field.type === 'integer' ? 1 : 0.05"
    @update:model-value="form.setInheritNumberField(field, $event)"
  />

  <v-text-field
    v-else-if="field.type === 'integer' || field.type === 'number'"
    :model-value="form.fieldValue(field.key)"
    type="number"
    :label="form.labelFor(field)"
    :hint="form.fullHintFor(field)"
    persistent-hint
    variant="outlined"
    density="compact"
    hide-details="auto"
    :min="field.min"
    :max="field.max"
    :step="field.type === 'integer' ? 1 : 0.05"
    @update:model-value="form.setField(field.key, $event)"
  />
</template>

<style scoped>
.plugin-slider-readout {
  min-width: 3rem;
  text-align: right;
}
</style>
