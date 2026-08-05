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
    :model-value="form.fieldValue(field.key)"
    :items="form.enumItems.value(field)"
    item-title="title"
    item-value="value"
    :label="form.labelFor(field)"
    :hint="form.hintFor(field)"
    persistent-hint
    variant="outlined"
    density="compact"
    hide-details="auto"
    @update:model-value="form.setField(field.key, $event)"
  />
</template>
