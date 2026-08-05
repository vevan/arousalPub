<script setup lang="ts">
import type { PluginSettingsFieldSchema } from '@/plugins/plugin-settings-types'
import {
  inheritTriModeForBoolean,
  type InheritTriMode,
} from '@/utils/plugin-inherit-tri-mode'
import { usePluginSchemaFormApi } from '@/components/settings/plugin-schema/injection'
import { useI18n } from 'vue-i18n'

defineProps<{
  field: PluginSettingsFieldSchema
}>()

const form = usePluginSchemaFormApi()
const { t } = useI18n()
</script>

<template>
  <div v-if="field.type === 'boolean' && field.widget === 'inheritTriMode'">
    <div class="text-body-2 font-weight-medium mb-1">
      {{ form.labelFor(field) }}
    </div>
    <p
      v-if="form.hintFor(field)"
      class="text-caption text-medium-emphasis mb-2"
    >
      {{ form.hintFor(field) }}
    </p>
    <v-btn-toggle
      :model-value="inheritTriModeForBoolean(form.modelValue.value, field.key)"
      mandatory
      divided
      density="compact"
      color="primary"
      variant="outlined"
      class="plugin-inherit-tri-mode__toggle"
      @update:model-value="form.setInheritTriModeBoolean(field, $event as InheritTriMode)"
    >
      <v-btn
        v-for="item in form.inheritTriModeItems(
          t('settings.plugins.inheritTriModeInherit', {
            value: form.inheritTriModeGlobalLabel(field),
          }),
        )"
        :key="item.value"
        :value="item.value"
        size="small"
        class="text-none"
      >
        {{ item.title }}
      </v-btn>
    </v-btn-toggle>
  </div>

  <div v-else-if="field.type === 'boolean'">
    <v-switch
      :model-value="Boolean(form.fieldValue(field.key))"
      :label="form.labelFor(field)"
      :hint="form.fullHintFor(field)"
      persistent-hint
      color="primary"
      hide-details="auto"
      @update:model-value="form.setField(field.key, $event)"
    />
    <slot
      v-if="field.companionPanel && $slots['field-companion-panel']"
      name="field-companion-panel"
      :field-key="field.key"
      :companion-panel="field.companionPanel"
    />
    <template v-else>
      <div
        v-if="form.companionLinesFor(field.key).length > 0"
        class="plugin-field-companion ps-1 mt-n1 mb-3"
      >
        <p
          v-for="(line, ci) in form.companionLinesFor(field.key)"
          :key="ci"
          class="text-caption text-medium-emphasis mb-0"
        >
          {{ line }}
        </p>
      </div>
      <div
        v-if="$slots['field-companion-extra']"
        class="plugin-field-companion-extra ps-1 mb-3"
      >
        <slot
          name="field-companion-extra"
          :field-key="field.key"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.plugin-inherit-tri-mode__toggle {
  flex-wrap: wrap;
  height: auto !important;
}
</style>
