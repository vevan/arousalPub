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
  <div class="plugin-schema-form__checkbox-group">
    <template v-if="field.collapsible">
      <v-expansion-panels
        variant="accordion"
        class="plugin-schema-form__checkbox-group-panels"
      >
        <v-expansion-panel>
          <v-expansion-panel-title class="text-body-2 py-2">
            <div class="d-flex flex-column align-start min-w-0">
              <span class="font-weight-medium">{{ form.labelFor(field) }}</span>
              <span
                v-if="form.checkboxGroupSummary(field)"
                class="text-caption text-medium-emphasis text-truncate"
              >
                {{ form.checkboxGroupSummary(field) }}
              </span>
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text class="pt-1">
            <p
              v-if="form.fullHintFor(field)"
              class="text-caption text-medium-emphasis mb-2"
            >
              {{ form.fullHintFor(field) }}
            </p>
            <v-progress-linear
              v-if="form.optionsSourceLoading.value && field.optionsSource"
              indeterminate
              color="primary"
              class="mb-2"
            />
            <div
              v-if="form.checkboxOptionsFor(field).length > 0"
              class="plugin-schema-form__checkbox-group-scroll"
            >
              <v-checkbox
                v-for="opt in form.checkboxOptionsFor(field)"
                :key="opt.value"
                :model-value="form.isCheckboxSelected(field.key, opt.value)"
                :label="opt.title"
                hide-details
                density="compact"
                @update:model-value="form.toggleCheckbox(field.key, opt.value, $event)"
              />
            </div>
            <p
              v-else-if="!form.optionsSourceLoading.value || !field.optionsSource"
              class="text-caption text-medium-emphasis mb-0"
            >
              {{ t('settings.plugins.checkboxGroupEmpty') }}
            </p>
            <template
              v-for="panelKey in field.panelFieldKeys ?? []"
              :key="panelKey"
            >
              <v-switch
                v-if="form.fieldSchemaByKey(panelKey, form.fields.value)?.type === 'boolean'"
                :model-value="Boolean(form.fieldValue(panelKey))"
                :label="form.labelFor(form.fieldSchemaByKey(panelKey, form.fields.value)!)"
                :hint="form.fullHintFor(form.fieldSchemaByKey(panelKey, form.fields.value)!)"
                persistent-hint
                color="primary"
                hide-details="auto"
                class="mt-2"
                @update:model-value="form.setField(panelKey, $event)"
              />
            </template>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </template>
    <template v-else>
      <div class="text-body-2 font-weight-medium mb-1">
        {{ form.labelFor(field) }}
      </div>
      <p
        v-if="form.fullHintFor(field)"
        class="text-caption text-medium-emphasis mb-2"
      >
        {{ form.fullHintFor(field) }}
      </p>
      <v-progress-linear
        v-if="form.optionsSourceLoading.value && field.optionsSource"
        indeterminate
        color="primary"
        class="mb-2"
      />
      <template v-if="form.checkboxOptionsFor(field).length > 0">
        <v-checkbox
          v-for="opt in form.checkboxOptionsFor(field)"
          :key="opt.value"
          :model-value="form.isCheckboxSelected(field.key, opt.value)"
          :label="opt.title"
          hide-details
          density="compact"
          @update:model-value="form.toggleCheckbox(field.key, opt.value, $event)"
        />
      </template>
      <p
        v-else-if="!form.optionsSourceLoading.value || !field.optionsSource"
        class="text-caption text-medium-emphasis mb-0"
      >
        {{ t('settings.plugins.checkboxGroupEmpty') }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.plugin-schema-form__checkbox-group-panels {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  overflow: hidden;
}
.plugin-schema-form__checkbox-group-scroll {
  max-height: 280px;
  overflow-y: auto;
  padding-right: 4px;
}
</style>
