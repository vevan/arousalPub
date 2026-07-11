<script setup lang="ts">
import type { PluginFormFieldDef, PluginFormFieldOption } from '@/plugins/types'
import { formDialogKey } from '@/plugins/create-plugin-web-host'
import { PLUGIN_HOST_KEY } from '@/plugins/injection'
import {
  loadApiPresetSelectItems,
  loadLorebookSelectItems,
  needsApiPresetSelect,
  needsLorebookSelect,
  type PluginSchemaSelectItem,
} from '@/utils/plugin-schema-selects'
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const pluginHost = inject(PLUGIN_HOST_KEY)
const { t } = useI18n()

const apiPresetItems = ref<PluginSchemaSelectItem[]>([])
const lorebookItems = ref<PluginSchemaSelectItem[]>([])
const selectsLoading = ref(false)

const open = computed({
  get: () => pluginHost?.openForm.value != null,
  set: (v: boolean) => {
    if (!v && activeDef.value?.persistent) return
    if (!v) pluginHost?.cancelOpenForm()
  },
})

const activeDef = computed(() => {
  const state = pluginHost?.openForm.value
  if (!state || !pluginHost) return null
  return pluginHost.formDialogs.get(formDialogKey(state.pluginId, state.dialogId)) ?? null
})

const model = computed(() => pluginHost?.openForm.value?.model ?? {})

const dialogTitle = computed(() => {
  const def = activeDef.value
  const state = pluginHost?.openForm.value
  if (!def || !state) return ''
  if (def.titleKeys) {
    const mode = model.value.mode
    if (mode === 'regenerate') {
      return t(def.titleKeys.regenerate, state.titleParams ?? {})
    }
    if (mode === 'revise') {
      return t(
        def.titleKeys.revise ?? def.titleKeys.regenerate,
        state.titleParams ?? {},
      )
    }
    return t(def.titleKeys.send, state.titleParams ?? {})
  }
  return t(def.titleKey, state.titleParams ?? {})
})

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
  const mode = model.value.mode
  if (mode === 'regenerate') return t(def.submitKeys?.regenerate ?? '')
  if (mode === 'revise') return t(def.submitKeys?.revise ?? def.submitKeys?.regenerate ?? '')
  return t(def.submitKeys?.send ?? '')
})

const cancelLabel = computed(() => {
  const def = activeDef.value
  if (!def?.cancelKey) return t('settings.themeCancel')
  return t(def.cancelKey)
})

const skipLabel = computed(() => {
  const def = activeDef.value
  if (!def?.skipKey) return ''
  return t(def.skipKey)
})

const hasSkip = computed(() => Boolean(activeDef.value?.skipKey && activeDef.value?.onSkip))

const regenerateLabel = computed(() => {
  const def = activeDef.value
  if (!def?.regenerateKey) return ''
  return t(def.regenerateKey)
})

const hasRegenerate = computed(() => {
  const def = activeDef.value
  if (!def?.onRegenerate) return false
  if (def.regenerateVisible && pluginHost && !def.regenerateVisible(pluginHost.host)) {
    return false
  }
  return true
})

const canRegenerate = computed(() => {
  const def = activeDef.value
  if (!hasRegenerate.value || !def) return false
  if (def.regenerateCanSubmit && !def.regenerateCanSubmit(model.value)) return false
  return !submitting.value
})

const isPersistent = computed(() => activeDef.value?.persistent === true)

function onDialogOutside() {
  if (isPersistent.value) return
  pluginHost?.cancelOpenForm()
}

const submitting = computed(() => pluginHost?.formSubmitting.value ?? false)

watch(
  () => pluginHost?.openForm.value,
  async (state) => {
    if (!state || !pluginHost) return
    const def = pluginHost.formDialogs.get(formDialogKey(state.pluginId, state.dialogId))
    if (!def) return
    const needApi = needsApiPresetSelect(def.fields)
    const needLb = needsLorebookSelect(def.fields)
    if (!needApi && !needLb) return
    selectsLoading.value = true
    try {
      const [api, lb] = await Promise.all([
        needApi ? loadApiPresetSelectItems() : Promise.resolve([]),
        needLb ? loadLorebookSelectItems() : Promise.resolve([]),
      ])
      apiPresetItems.value = api
      lorebookItems.value = lb
    } finally {
      selectsLoading.value = false
    }
  },
)

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

function setFieldValue(key: string, value: string | null, readOnly?: boolean) {
  const state = pluginHost?.openForm.value
  if (!state || readOnly) return
  state.model[key] = value ?? ''
}

function optionLabel(opt: PluginFormFieldOption): string {
  if (opt.label) return opt.label
  if (opt.labelKey) return t(opt.labelKey)
  return opt.value
}

function checkboxValues(key: string): string[] {
  const v = model.value[key]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function isCheckboxSelected(key: string, value: string): boolean {
  return checkboxValues(key).includes(value)
}

function toggleCheckbox(
  key: string,
  value: string,
  checked: boolean | null,
  locked?: boolean,
) {
  const state = pluginHost?.openForm.value
  if (!state) return
  if (locked && checked !== true) return
  const cur = checkboxValues(key)
  state.model[key] =
    checked === true ? [...new Set([...cur, value])] : cur.filter((x) => x !== value)
}

function resourceSelectItems(field: PluginFormFieldDef): PluginSchemaSelectItem[] {
  if (field.type === 'apiPreset') return apiPresetItems.value
  if (field.type === 'lorebook') return lorebookItems.value
  return []
}

function resourceSelectClearable(field: PluginFormFieldDef): boolean {
  if (field.type === 'lorebook') return true
  if (field.type === 'apiPreset') return true
  return false
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="640"
    scrollable
    :persistent="isPersistent"
    @click:outside="onDialogOutside"
  >
    <v-card v-if="activeDef && pluginHost">
      <v-card-title class="text-h6">
        {{ dialogTitle }}
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
                :label="optionLabel(opt)"
                :value="opt.value"
              />
            </v-radio-group>

            <div
              v-else-if="field.type === 'checkboxGroup' && field.options?.length"
              class="plugin-form-dialog__checkbox-group"
            >
              <div class="text-body-2 font-weight-medium mb-1">
                {{ t(field.labelKey) }}
              </div>
              <v-checkbox
                v-for="opt in field.options"
                :key="opt.value"
                :model-value="isCheckboxSelected(field.key, opt.value)"
                :label="optionLabel(opt)"
                :disabled="opt.locked === true"
                hide-details
                density="compact"
                @update:model-value="toggleCheckbox(field.key, opt.value, $event, opt.locked)"
              />
              <p
                v-if="field.hintKey"
                class="plugin-form-dialog__hint text-caption text-medium-emphasis"
              >
                {{ t(field.hintKey) }}
              </p>
            </div>

            <template v-else-if="field.type === 'text'">
              <v-text-field
                :model-value="fieldValue(field.key)"
                :label="t(field.labelKey)"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                :readonly="field.readOnly === true"
                @update:model-value="setFieldValue(field.key, $event, field.readOnly)"
              />
              <p
                v-if="field.hintKey"
                class="plugin-form-dialog__hint text-caption text-medium-emphasis"
              >
                {{ t(field.hintKey) }}
              </p>
            </template>

            <template v-else-if="field.type === 'integer'">
              <v-text-field
                :model-value="fieldValue(field.key)"
                :label="t(field.labelKey)"
                type="number"
                min="0"
                variant="outlined"
                density="comfortable"
                hide-details
                :readonly="field.readOnly === true"
                @update:model-value="setFieldValue(field.key, $event, field.readOnly)"
              />
              <p
                v-if="field.hintKey"
                class="plugin-form-dialog__hint text-caption text-medium-emphasis"
              >
                {{ t(field.hintKey) }}
              </p>
            </template>

            <template v-else-if="field.type === 'apiPreset' || field.type === 'lorebook'">
              <v-select
                :model-value="fieldValue(field.key) || null"
                :items="resourceSelectItems(field)"
                item-title="title"
                item-value="value"
                :label="t(field.labelKey)"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                :loading="selectsLoading"
                :clearable="resourceSelectClearable(field)"
                :placeholder="
                  field.type === 'lorebook'
                    ? t('settings.plugins.selectEmptyDefault')
                    : t('settings.plugins.selectApiPreset')
                "
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
              :readonly="field.readOnly === true"
              @update:model-value="setFieldValue(field.key, $event, field.readOnly)"
            />
          </div>
        </template>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-3">
        <v-btn
          variant="text"
          :disabled="submitting"
          @click="pluginHost.cancelOpenForm()"
        >
          {{ cancelLabel }}
        </v-btn>
        <v-btn
          v-if="hasSkip"
          variant="text"
          :disabled="submitting"
          class="ml-1"
          @click="pluginHost.skipOpenForm()"
        >
          {{ skipLabel }}
        </v-btn>
        <v-spacer />
        <v-btn
          v-if="hasRegenerate"
          variant="text"
          :loading="submitting"
          :disabled="!canRegenerate"
          @click="pluginHost.regenerateOpenForm()"
        >
          {{ regenerateLabel }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="submitting"
          :disabled="!canSubmit || submitting"
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
