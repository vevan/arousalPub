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
    const mode = String(model.value.mode ?? '')
    const key = def.titleKeys[mode]
    if (key) return t(key, state.titleParams ?? {})
  }
  return t(def.titleKey, state.titleParams ?? {})
})

const visibleFields = computed(() => {
  const def = activeDef.value
  if (!def) return []
  return def.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => isFieldVisible(field, model.value))
})

const canSubmit = computed(() => {
  const def = activeDef.value
  if (!def) return false
  return def.canSubmit(model.value)
})

const submitLabel = computed(() => {
  const def = activeDef.value
  if (!def) return ''
  const tabId = activeTabId.value
  if (
    tabId &&
    def.tabs?.length &&
    (!def.tabsVisible || def.tabsVisible(model.value))
  ) {
    const tab = def.tabs.find((x) => x.id === tabId)
    if (tab?.submitKey) return t(tab.submitKey)
  }
  if (def.submitKey) return t(def.submitKey)
  const mode = String(model.value.mode ?? '')
  const key = def.submitKeys?.[mode]
  return key ? t(key) : ''
})

const tabFieldName = computed(() => activeDef.value?.tabField?.trim() || 'tab')

const dialogTabs = computed(() => {
  const def = activeDef.value
  if (!def?.tabs?.length) return []
  if (def.tabsVisible && !def.tabsVisible(model.value)) return []
  return def.tabs
})

const activeTabId = computed(() => {
  const tabs = dialogTabs.value
  if (!tabs.length) return ''
  const raw = model.value[tabFieldName.value]
  if (typeof raw === 'string' && tabs.some((t) => t.id === raw)) return raw
  return tabs[0]!.id
})

const activeTabModel = computed({
  get: () => activeTabId.value,
  set: (id: unknown) => {
    const state = pluginHost?.openForm.value
    if (!state || typeof id !== 'string') return
    if (!dialogTabs.value.some((t) => t.id === id)) return
    state.model[tabFieldName.value] = id
  },
})

watch(
  activeTabId,
  (id) => {
    const state = pluginHost?.openForm.value
    if (!state || !id) return
    if (state.model[tabFieldName.value] === id) return
    state.model[tabFieldName.value] = id
  },
)

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

const extraActionLabel = computed(() => {
  const def = activeDef.value
  if (!def?.extraActionKey) return ''
  return t(def.extraActionKey)
})

const hasExtraAction = computed(() => {
  const def = activeDef.value
  if (!def?.onExtraAction) return false
  if (
    def.extraActionVisible &&
    pluginHost &&
    !def.extraActionVisible(pluginHost.host, model.value)
  ) {
    return false
  }
  return true
})

const canExtraAction = computed(() => {
  const def = activeDef.value
  if (!hasExtraAction.value || !def) return false
  if (def.extraActionCanSubmit && !def.extraActionCanSubmit(model.value)) return false
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
    if (def.tabs?.length && (!def.tabsVisible || def.tabsVisible(state.model))) {
      const field = def.tabField?.trim() || 'tab'
      const cur = state.model[field]
      const known = def.tabs.some((t) => t.id === cur)
      if (!known) state.model[field] = def.tabs[0]!.id
    }
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
  const rules = Array.isArray(vw) ? vw : [vw]
  return rules.every((rule) => m[rule.field] === rule.equals)
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
      <v-tabs
        v-if="dialogTabs.length > 0"
        v-model="activeTabModel"
        color="primary"
        density="compact"
        class="px-2 plugin-form-dialog__tabs"
      >
        <v-tab
          v-for="tab in dialogTabs"
          :key="tab.id"
          :value="tab.id"
        >
          {{ t(tab.labelKey) }}
        </v-tab>
      </v-tabs>
      <v-divider />
      <v-card-text class="pa-4 plugin-form-dialog__fields">
        <template
          v-for="row in visibleFields"
          :key="`${row.field.key}:${row.index}`"
        >
          <div class="plugin-form-dialog__field">
            <v-radio-group
              v-if="row.field.type === 'radio' && row.field.options?.length"
              :model-value="fieldValue(row.field.key)"
              :label="t(row.field.labelKey)"
              hide-details
              @update:model-value="setFieldValue(row.field.key, $event)"
            >
              <v-radio
                v-for="opt in row.field.options"
                :key="opt.value"
                :label="optionLabel(opt)"
                :value="opt.value"
              />
            </v-radio-group>

            <div
              v-else-if="row.field.type === 'checkboxGroup' && row.field.options?.length"
              class="plugin-form-dialog__checkbox-group"
            >
              <div class="text-body-2 font-weight-medium mb-1">
                {{ t(row.field.labelKey) }}
              </div>
              <v-checkbox
                v-for="opt in row.field.options"
                :key="opt.value"
                :model-value="isCheckboxSelected(row.field.key, opt.value)"
                :label="optionLabel(opt)"
                :disabled="opt.locked === true"
                hide-details
                density="compact"
                @update:model-value="toggleCheckbox(row.field.key, opt.value, $event, opt.locked)"
              />
              <p
                v-if="row.field.hintKey"
                class="plugin-form-dialog__hint text-caption text-medium-emphasis"
              >
                {{ t(row.field.hintKey) }}
              </p>
            </div>

            <template v-else-if="row.field.type === 'text'">
              <v-text-field
                :model-value="fieldValue(row.field.key)"
                :label="t(row.field.labelKey)"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                :readonly="row.field.readOnly === true"
                @update:model-value="setFieldValue(row.field.key, $event, row.field.readOnly)"
              />
              <p
                v-if="row.field.hintKey"
                class="plugin-form-dialog__hint text-caption text-medium-emphasis"
              >
                {{ t(row.field.hintKey) }}
              </p>
            </template>

            <template v-else-if="row.field.type === 'integer'">
              <v-text-field
                :model-value="fieldValue(row.field.key)"
                :label="t(row.field.labelKey)"
                type="number"
                :min="row.field.min ?? 0"
                :max="row.field.max"
                variant="outlined"
                density="comfortable"
                hide-details
                :readonly="row.field.readOnly === true"
                @update:model-value="setFieldValue(row.field.key, $event, row.field.readOnly)"
              />
              <p
                v-if="row.field.hintKey"
                class="plugin-form-dialog__hint text-caption text-medium-emphasis"
              >
                {{ t(row.field.hintKey) }}
              </p>
            </template>

            <template v-else-if="row.field.type === 'apiPreset' || row.field.type === 'lorebook'">
              <v-select
                :model-value="fieldValue(row.field.key) || null"
                :items="resourceSelectItems(row.field)"
                item-title="title"
                item-value="value"
                :label="t(row.field.labelKey)"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                :loading="selectsLoading"
                :clearable="resourceSelectClearable(row.field)"
                :placeholder="
                  row.field.type === 'lorebook'
                    ? t('settings.plugins.selectEmptyDefault')
                    : t('settings.plugins.selectApiPreset')
                "
                @update:model-value="setFieldValue(row.field.key, $event)"
              />
              <p
                v-if="row.field.hintKey"
                class="plugin-form-dialog__hint text-caption text-medium-emphasis"
              >
                {{ t(row.field.hintKey) }}
              </p>
            </template>

            <v-textarea
              v-else
              :model-value="fieldValue(row.field.key)"
              :label="t(row.field.labelKey)"
              rows="3"
              auto-grow
              max-rows="12"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              :readonly="row.field.readOnly === true"
              @update:model-value="setFieldValue(row.field.key, $event, row.field.readOnly)"
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
          v-if="hasExtraAction"
          variant="text"
          :loading="submitting"
          :disabled="!canExtraAction"
          @click="pluginHost.runFormExtraAction()"
        >
          {{ extraActionLabel }}
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
