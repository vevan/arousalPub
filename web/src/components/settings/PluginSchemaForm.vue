<script setup lang="ts">
import type { PluginSettingsFieldSchema } from '@/plugins/plugin-settings-types'
import { PLUGIN_SCHEMA_FORM_KEY } from '@/components/settings/plugin-schema/injection'
import { usePluginSchemaForm } from '@/composables/settings/usePluginSchemaForm'
import BooleanFields from '@/components/settings/plugin-schema/BooleanFields.vue'
import NumberField from '@/components/settings/plugin-schema/NumberField.vue'
import EnumField from '@/components/settings/plugin-schema/EnumField.vue'
import CheckboxGroupField from '@/components/settings/plugin-schema/CheckboxGroupField.vue'
import ResourceSelectField from '@/components/settings/plugin-schema/ResourceSelectField.vue'
import TextFields from '@/components/settings/plugin-schema/TextFields.vue'
import ObjectListField from '@/components/settings/plugin-schema/ObjectListField.vue'
import StringFields from '@/components/settings/plugin-schema/StringFields.vue'
import BundledAssetPreviewField from '@/components/settings/plugin-schema/BundledAssetPreviewField.vue'
import FileAssetField from '@/components/settings/plugin-schema/FileAssetField.vue'
import { provide } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  pluginId: string
  fields: PluginSettingsFieldSchema[]
  modelValue: Record<string, unknown>
  /** 会话 schema：展示 inheritFromGlobalKey 对应的全局值 */
  globalSettings?: Record<string, unknown>
  /** 某字段下方的补充说明行 */
  fieldCompanionLines?: (fieldKey: string) => string[] | undefined
  /** 文本字段失焦后再提交，避免逐字触发保存 */
  deferTextCommit?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
  'footer-validation-error': [message: string | null]
}>()

const { t } = useI18n()
const { api, isFieldVisible, commitAllTextDrafts, validateAllJsonSampleStateFields } =
  usePluginSchemaForm(props, emit)

provide(PLUGIN_SCHEMA_FORM_KEY, api)

const {
  objectListRemoveOpen,
  objectListRemoveTitle,
  cancelRemoveObjectListItem,
  confirmRemoveObjectListItem,
} = api

function onRemoveDialogModel(open: boolean) {
  if (!open) cancelRemoveObjectListItem()
}

defineExpose({
  commitAllTextDrafts,
  validateAllJsonSampleStateFields,
})
</script>

<template>
  <div class="plugin-schema-form d-flex flex-column ga-4">
    <template
      v-for="field in fields"
      :key="field.key"
    >
      <template v-if="isFieldVisible(field)">
        <BooleanFields
          v-if="field.type === 'boolean'"
          :field="field"
        >
          <template
            v-if="$slots['field-companion-panel']"
            #field-companion-panel="slotProps"
          >
            <slot
              name="field-companion-panel"
              v-bind="slotProps"
            />
          </template>
          <template
            v-if="$slots['field-companion-extra']"
            #field-companion-extra="slotProps"
          >
            <slot
              name="field-companion-extra"
              v-bind="slotProps"
            />
          </template>
        </BooleanFields>

        <NumberField
          v-else-if="field.type === 'integer' || field.type === 'number'"
          :field="field"
        />

        <EnumField
          v-else-if="field.type === 'enum'"
          :field="field"
        />

        <CheckboxGroupField
          v-else-if="field.type === 'checkboxGroup'"
          :field="field"
        />

        <ResourceSelectField
          v-else-if="field.type === 'apiPreset' || field.type === 'lorebook'"
          :field="field"
        />

        <TextFields
          v-else-if="field.type === 'text'"
          :field="field"
        />

        <ObjectListField
          v-else-if="field.type === 'objectList'"
          :field="field"
        />

        <StringFields
          v-else-if="field.type === 'string'"
          :field="field"
        />

        <BundledAssetPreviewField
          v-else-if="field.type === 'bundledAssetPreview'"
          :field="field"
        />

        <FileAssetField
          v-else-if="field.type === 'fileAsset'"
          :field="field"
        />
      </template>
    </template>

    <v-dialog
      :model-value="objectListRemoveOpen"
      max-width="400"
      @update:model-value="onRemoveDialogModel"
      @click:outside="cancelRemoveObjectListItem"
    >
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{ t('settings.plugins.removeItemConfirmTitle') }}
        </v-card-title>
        <v-card-text class="text-body-2">
          {{
            t('settings.plugins.removeItemConfirmBody', {
              name: objectListRemoveTitle,
            })
          }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="tonal"
            size="small"
            class="text-none"
            @click="cancelRemoveObjectListItem"
          >
            {{ t('settings.plugins.removeItemCancel') }}
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            @click="confirmRemoveObjectListItem"
          >
            {{ t('settings.plugins.removeItemConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
