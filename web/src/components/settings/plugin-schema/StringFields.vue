<script setup lang="ts">
import type { PluginSettingsFieldSchema } from '@/plugins/plugin-settings-types'
import { usePluginSchemaFormApi } from '@/components/settings/plugin-schema/injection'

defineProps<{
  field: PluginSettingsFieldSchema
}>()

const form = usePluginSchemaFormApi()
</script>

<template>
  <v-select
    v-if="form.isBundleSelectField(field)"
    :model-value="String(form.fieldValue(field.key) ?? '')"
    :items="form.bundleSelectOptions(field)"
    item-title="title"
    item-value="value"
    :label="form.labelFor(field)"
    :hint="form.hintFor(field)"
    persistent-hint
    variant="outlined"
    density="compact"
    hide-details="auto"
    @update:model-value="form.setField(field.key, $event ?? '')"
  />

  <v-text-field
    v-else
    :model-value="
      form.deferTextCommit.value
        ? form.textDraftGet(field.key, form.fieldValue(field.key))
        : String(form.fieldValue(field.key) ?? '')
    "
    :label="form.labelFor(field)"
    :hint="form.hintFor(field)"
    persistent-hint
    variant="outlined"
    density="compact"
    hide-details="auto"
    @update:model-value="
      form.onTextInput(
        field.key,
        $event,
        () => form.fieldValue(field.key),
        (v) => form.setField(field.key, v),
      )
    "
    @blur="
      form.onTextBlur(
        field.key,
        () => form.fieldValue(field.key),
        (v) => form.setField(field.key, v),
      )
    "
  />
</template>
