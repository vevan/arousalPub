<script setup lang="ts">
import type { PluginSettingsFieldSchema } from '@/plugins/plugin-settings-types'
import { usePluginSchemaFormApi } from '@/components/settings/plugin-schema/injection'

defineProps<{
  field: PluginSettingsFieldSchema
}>()

const form = usePluginSchemaFormApi()
</script>

<template>
  <div class="plugin-schema-heading">
    <h3 class="text-subtitle-1 font-weight-medium mb-0">
      {{ form.labelFor(field) }}
    </h3>
    <p
      v-if="form.hintFor(field)"
      class="text-body-2 text-medium-emphasis mt-1 mb-0"
    >
      {{ form.hintFor(field) }}
    </p>
  </div>
</template>

<style scoped>
.plugin-schema-heading {
  padding-top: 4px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.plugin-schema-heading:first-child {
  padding-top: 0;
  border-top: none;
}
</style>
