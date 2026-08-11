<script setup lang="ts">
import type { PluginSettingsFieldSchema } from '@/plugins/plugin-settings-types'
import { pluginI18nKey } from '@/utils/plugin-settings-api'
import { usePluginSchemaFormApi } from '@/components/settings/plugin-schema/injection'
import { useI18n } from 'vue-i18n'

defineProps<{
  field: PluginSettingsFieldSchema
}>()

const form = usePluginSchemaFormApi()
const { t, te } = useI18n()
</script>

<template>
  <div class="plugin-file-asset">
    <div class="text-body-2 font-weight-medium mb-1">
      {{ form.labelFor(field) }}
    </div>
    <p
      v-if="form.hintFor(field)"
      class="text-caption text-medium-emphasis mb-2"
    >
      {{ form.hintFor(field) }}
    </p>
    <div class="d-flex flex-wrap align-center ga-2 mb-2">
      <v-file-input
        :accept="form.fileAccept(field)"
        density="compact"
        variant="outlined"
        hide-details
        prepend-icon="mdi-upload"
        :label="
          te(pluginI18nKey(form.pluginId.value, 'upload'))
            ? t(pluginI18nKey(form.pluginId.value, 'upload'))
            : t('settings.plugins.upload')
        "
        :loading="form.uploadingKey.value === field.key"
        @update:model-value="form.onFilePicked(field, $event)"
      />
    </div>
    <div
      v-if="String(form.fieldValue(field.key) ?? '').trim()"
      class="text-caption mb-2"
    >
      {{ form.fieldValue(field.key) }}
    </div>
    <audio
      v-if="form.previewUrl(field)"
      controls
      preload="none"
      class="plugin-file-asset__player"
      :src="form.previewUrl(field) ?? undefined"
    />
    <v-alert
      v-if="form.uploadError.value && form.uploadingKey.value === null"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-2"
    >
      {{ form.uploadError.value }}
    </v-alert>
  </div>
</template>

<style scoped>
.plugin-file-asset__player {
  width: 100%;
  max-width: 360px;
  height: 2.5rem;
}
</style>
