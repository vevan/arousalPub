<script setup lang="ts">
import type { PluginFormFieldDef } from '@/plugins/types'
import { PLUGIN_HOST_KEY } from '@/plugins/injection'
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'

const pluginHost = inject(PLUGIN_HOST_KEY)
const { t } = useI18n()

const open = computed({
  get: () => pluginHost?.openForm.value != null,
  set: (v: boolean) => {
    if (!v) pluginHost?.cancelOpenForm()
  },
})

const activeDef = computed(() => {
  const state = pluginHost?.openForm.value
  if (!state || !pluginHost) return null
  return pluginHost.formDialogs.get(state.pluginId) ?? null
})

const model = computed(() => pluginHost?.openForm.value?.model ?? {})

const visibleFields = computed(() => {
  const def = activeDef.value
  if (!def) return []
  return def.fields.filter((field) => isFieldVisible(field, model.value))
})

const canSubmit = computed(() => {
  const def = activeDef.value
  if (!def) return false
  return def.canSubmit(model.value)
})

const submitLabel = computed(() => {
  const def = activeDef.value
  if (!def) return ''
  if (def.submitKey) return t(def.submitKey)
  const mode = model.value.mode === 'regenerate' ? 'regenerate' : 'send'
  return t(def.submitKeys?.[mode] ?? '')
})

const cancelLabel = computed(() => {
  const def = activeDef.value
  if (!def?.cancelKey) return t('settings.themeCancel')
  return t(def.cancelKey)
})

const submitting = computed(() => pluginHost?.formSubmitting.value ?? false)

function isFieldVisible(
  field: PluginFormFieldDef,
  m: Record<string, unknown>,
): boolean {
  const vw = field.visibleWhen
  if (!vw) return true
  return m[vw.field] === vw.equals
}

function fieldValue(key: string): string {
  const v = model.value[key]
  return typeof v === 'string' ? v : v != null ? String(v) : ''
}

function setFieldValue(key: string, value: string | null) {
  const state = pluginHost?.openForm.value
  if (!state) return
  state.model[key] = value ?? ''
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="640"
    scrollable
    @click:outside="pluginHost?.cancelOpenForm()"
  >
    <v-card v-if="activeDef && pluginHost">
      <v-card-title class="text-h6">
        {{ t(activeDef.titleKey) }}
      </v-card-title>
      <v-card-text
        v-if="activeDef.bodyKey"
        class="text-body-2 text-medium-emphasis pt-0 pb-2 px-4"
      >
        {{ t(activeDef.bodyKey) }}
      </v-card-text>
      <v-divider />
      <v-card-text class="pa-4 plugin-form-dialog__fields">
        <template
          v-for="field in visibleFields"
          :key="field.key"
        >
          <div class="plugin-form-dialog__field">
            <v-radio-group
              v-if="field.type === 'radio' && field.options?.length"
              :model-value="fieldValue(field.key)"
              :label="t(field.labelKey)"
              hide-details
              @update:model-value="setFieldValue(field.key, $event)"
            >
              <v-radio
                v-for="opt in field.options"
                :key="opt.value"
                :label="t(opt.labelKey)"
                :value="opt.value"
              />
            </v-radio-group>

            <template v-else-if="field.type === 'integer'">
              <v-text-field
                :model-value="fieldValue(field.key)"
                :label="t(field.labelKey)"
                type="number"
                min="0"
                variant="outlined"
                density="comfortable"
                hide-details
                @update:model-value="setFieldValue(field.key, $event)"
              />
              <p
                v-if="field.hintKey"
                class="plugin-form-dialog__hint text-caption text-medium-emphasis"
              >
                {{ t(field.hintKey) }}
              </p>
            </template>

            <v-textarea
              v-else
              :model-value="fieldValue(field.key)"
              :label="t(field.labelKey)"
              rows="3"
              auto-grow
              max-rows="12"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              @update:model-value="setFieldValue(field.key, $event)"
            />
          </div>
        </template>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-3">
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="submitting"
          @click="pluginHost.cancelOpenForm()"
        >
          {{ cancelLabel }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="pluginHost.submitOpenForm()"
        >
          {{ submitLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.plugin-form-dialog__fields {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.plugin-form-dialog__field {
  width: 100%;
}

.plugin-form-dialog__hint {
  margin: 0.375rem 0 0;
  padding: 0 0.75rem;
  line-height: 1.4;
}
</style>
