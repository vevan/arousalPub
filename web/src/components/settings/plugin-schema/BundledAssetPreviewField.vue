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
    v-if="form.bundledAssetPreviewUrl(field)"
    class="plugin-default-preview"
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
    <div class="text-caption text-medium-emphasis mb-1">
      {{ field.assetPath }}
    </div>
    <audio
      controls
      preload="none"
      class="plugin-file-asset__player"
      :src="form.bundledAssetPreviewUrl(field) ?? undefined"
    />
  </div>
</template>

<style scoped>
.plugin-file-asset__player {
  width: 100%;
  max-width: 360px;
  height: 2.5rem;
}
</style>
