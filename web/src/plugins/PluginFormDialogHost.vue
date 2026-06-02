<script setup lang="ts">
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

const canSubmit = computed(() => {
  const def = activeDef.value
  if (!def) return false
  return def.canSubmit(model.value)
})

const submitLabel = computed(() => {
  const def = activeDef.value
  if (!def) return ''
  const mode = model.value.mode === 'regenerate' ? 'regenerate' : 'send'
  return t(def.submitKeys[mode])
})

const submitting = computed(() => pluginHost?.formSubmitting.value ?? false)

function fieldValue(key: string): string {
  const v = model.value[key]
  return typeof v === 'string' ? v : v != null ? String(v) : ''
}

function setFieldValue(key: string, value: string) {
  const state = pluginHost?.openForm.value
  if (!state) return
  state.model[key] = value
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
      <v-divider />
      <v-card-text class="pa-4 d-flex flex-column gap-3">
        <v-textarea
          v-for="field in activeDef.fields"
          :key="field.key"
          :model-value="fieldValue(field.key)"
          :label="t(field.labelKey)"
          rows="3"
          auto-grow
          max-rows="12"
          variant="outlined"
          density="compact"
          hide-details="auto"
          @update:model-value="setFieldValue(field.key, $event)"
        />
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-3">
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="submitting"
          @click="pluginHost.cancelOpenForm()"
        >
          {{ t('settings.themeCancel') }}
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
