<script setup lang="ts">
import type { PluginSettingsFieldSchema } from '@/plugins/plugin-settings-types'
import { usePluginSchemaFormApi } from '@/components/settings/plugin-schema/injection'
import { useI18n } from 'vue-i18n'

defineProps<{
  field: PluginSettingsFieldSchema
}>()

const form = usePluginSchemaFormApi()
const { t } = useI18n()
</script>

<template>
  <v-select
    :model-value="String(form.fieldValue(field.key) ?? '') || null"
    :items="form.resourceSelectItems(field)"
    item-title="title"
    item-value="value"
    :label="form.labelFor(field)"
    :hint="field.type === 'apiPreset' ? form.apiPresetSelectHint(field) : form.hintFor(field)"
    persistent-hint
    variant="outlined"
    density="compact"
    hide-details="auto"
    :loading="form.selectsLoading.value"
    :clearable="form.resourceSelectClearable(field)"
    :placeholder="
      field.type === 'lorebook'
        ? t('settings.plugins.selectEmptyDefault')
        : field.conversationInherit
          ? t('settings.plugins.selectApiPresetInherit')
          : t('settings.plugins.selectApiPreset')
    "
    @update:model-value="form.setResourceSelectField(field, $event)"
  />
</template>
