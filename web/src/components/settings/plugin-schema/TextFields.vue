<script setup lang="ts">
import type { PluginSettingsFieldSchema } from '@/plugins/plugin-settings-types'
import { pluginI18nKey } from '@/utils/plugin-settings-api'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'
import {
  inheritTriModeForSheet,
  sheetTitle,
  type InheritTriMode,
} from '@/utils/plugin-inherit-tri-mode'
import { usePluginSchemaFormApi } from '@/components/settings/plugin-schema/injection'
import { useI18n } from 'vue-i18n'

defineProps<{
  field: PluginSettingsFieldSchema
}>()

const form = usePluginSchemaFormApi()
const { t, te } = useI18n()
</script>

<template>
  <div
    v-if="
      field.type === 'text' &&
      field.widget === 'inheritTriModeSheetList' &&
      field.inheritTriModeSheetList
    "
    class="plugin-inherit-tri-mode-sheet-list d-flex flex-column ga-4"
  >
    <div>
      <div class="text-body-2 font-weight-medium mb-1">
        {{ form.labelFor(field) }}
      </div>
      <p
        v-if="
          field.inheritTriModeSheetList.emptyLabelKey &&
          form.inheritTriModeSheetRows(field).length === 0
        "
        class="text-caption text-medium-emphasis mb-0"
      >
        {{
          translatePluginI18nKey(
            pluginI18nKey(
              form.pluginId.value,
              field.inheritTriModeSheetList.emptyLabelKey,
            ),
            t,
            te,
          )
        }}
      </p>
    </div>
    <div
      v-for="(sheet, index) in form.inheritTriModeSheetRows(field)"
      :key="String(sheet.id ?? index)"
      class="plugin-inherit-tri-mode-sheet-list__sheet rounded-lg border pa-3"
    >
      <div class="text-body-2 font-weight-medium mb-2">
        {{ sheetTitle(sheet, index) }}
      </div>
      <v-btn-toggle
        v-if="typeof sheet.id === 'string' && sheet.id.trim()"
        :model-value="inheritTriModeForSheet(form.modelValue.value, String(sheet.id))"
        mandatory
        divided
        density="compact"
        color="primary"
        variant="outlined"
        class="plugin-inherit-tri-mode__toggle"
        @update:model-value="
          form.setInheritTriModeSheet(field, String(sheet.id), $event as InheritTriMode)
        "
      >
        <v-btn
          v-for="item in form.inheritTriModeSheetItems(sheet)"
          :key="item.value"
          :value="item.value"
          size="small"
          class="text-none"
        >
          {{ item.title }}
        </v-btn>
      </v-btn-toggle>
    </div>
  </div>

  <div
    v-else-if="field.type === 'text' && field.widget === 'promptTemplate'"
    class="plugin-prompt-template"
  >
    <v-textarea
      :model-value="
        form.deferTextCommit.value
          ? form.textDraftGet(
              field.key,
              form.displayTextValue(field, form.fieldValue(field.key)),
            )
          : form.displayTextValue(field, form.fieldValue(field.key))
      "
      :label="form.labelFor(field)"
      :hint="form.hintFor(field)"
      persistent-hint
      variant="outlined"
      density="compact"
      auto-grow
      rows="4"
      :max-rows="16"
      hide-details="auto"
      @update:model-value="
        form.onTextInput(
          field.key,
          $event,
          () => form.displayTextValue(field, form.fieldValue(field.key)),
          (v) => form.setField(field.key, v),
        )
      "
      @blur="
        form.onTextBlur(
          field.key,
          () => form.displayTextValue(field, form.fieldValue(field.key)),
          (v) => form.setField(field.key, v),
        )
      "
    />
    <v-btn
      v-if="field.defaultKey"
      variant="tonal"
      color="primary"
      size="small"
      prepend-icon="mdi-backup-restore"
      class="mt-1 text-none"
      @click="form.restoreDefaultPrompt(field, (v) => form.setField(field.key, v))"
    >
      {{ form.restoreDefaultLabel() }}
    </v-btn>
  </div>

  <v-textarea
    v-else-if="field.type === 'text'"
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
    auto-grow
    rows="4"
    :max-rows="16"
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

<style scoped>
.plugin-prompt-template :deep(.v-btn) {
  margin-bottom: 4px;
}
.plugin-inherit-tri-mode-sheet-list__sheet {
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}
.plugin-inherit-tri-mode__toggle {
  flex-wrap: wrap;
  height: auto !important;
}
</style>
