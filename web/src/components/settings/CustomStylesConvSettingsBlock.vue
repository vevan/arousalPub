<script setup lang="ts">
import { parseObjectListField } from '@/utils/plugin-settings-validate'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const PLUGIN_ID = 'custom-styles'

type TriMode = 'inherit' | 'on' | 'off'

const props = defineProps<{
  convModel: Record<string, unknown>
  globalModel?: Record<string, unknown>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', model: Record<string, unknown>): void
}>()

const { t, te } = useI18n()

function pluginT(key: string, params?: Record<string, unknown>): string {
  const fullKey = `plugins.${PLUGIN_ID}.${key}`
  const text = translatePluginI18nKey(fullKey, t, te, params)
  return text.startsWith('plugins.') ? key : text
}

const globalSheets = computed(() =>
  parseObjectListField(props.globalModel?.sheets),
)

const globalEnabledOn = computed(() => props.globalModel?.enabled !== false)

const globalEnabledLabel = computed(() =>
  globalEnabledOn.value ? pluginT('convGlobalOn') : pluginT('convGlobalOff'),
)

function parseOverrides(model: Record<string, unknown>): Record<string, boolean> {
  const raw = model.sheetOverrides
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, boolean>
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {}
      }
      return parsed as Record<string, boolean>
    } catch {
      return {}
    }
  }
  return {}
}

function enabledMode(): TriMode {
  const v = props.convModel.enabled
  if (v === true) return 'on'
  if (v === false) return 'off'
  return 'inherit'
}

function sheetMode(sheetId: string): TriMode {
  const overrides = parseOverrides(props.convModel)
  if (!Object.prototype.hasOwnProperty.call(overrides, sheetId)) {
    return 'inherit'
  }
  return overrides[sheetId] === true ? 'on' : 'off'
}

function globalSheetEnabledLabel(sheet: Record<string, unknown>): string {
  return sheet.enabled !== false
    ? pluginT('convGlobalOn')
    : pluginT('convGlobalOff')
}

function sheetTitle(sheet: Record<string, unknown>, index: number): string {
  const name = typeof sheet.name === 'string' ? sheet.name.trim() : ''
  return name || `#${index + 1}`
}

function emitModel(next: Record<string, unknown>) {
  emit('update:modelValue', next)
}

function setEnabledMode(mode: TriMode) {
  const next = { ...props.convModel }
  if (mode === 'inherit') {
    delete next.enabled
  } else {
    next.enabled = mode === 'on'
  }
  emitModel(next)
}

function setSheetMode(sheetId: string, mode: TriMode) {
  const overrides = { ...parseOverrides(props.convModel) }
  if (mode === 'inherit') {
    delete overrides[sheetId]
  } else {
    overrides[sheetId] = mode === 'on'
  }
  const next = { ...props.convModel }
  if (Object.keys(overrides).length === 0) {
    delete next.sheetOverrides
  } else {
    next.sheetOverrides = JSON.stringify(overrides)
  }
  emitModel(next)
}

const triModeItems = (inheritLabel: string) => [
  { title: inheritLabel, value: 'inherit' as TriMode },
  { title: pluginT('convModeOn'), value: 'on' as TriMode },
  { title: pluginT('convModeOff'), value: 'off' as TriMode },
]
</script>

<template>
  <div class="custom-styles-conv-settings d-flex flex-column ga-4">
    <div>
      <div class="text-body-2 font-weight-medium mb-1">
        {{ pluginT('convEnabledLabel') }}
      </div>
      <p class="text-caption text-medium-emphasis mb-2">
        {{ pluginT('convEnabledDesc') }}
      </p>
      <v-btn-toggle
        :model-value="enabledMode()"
        mandatory
        divided
        density="compact"
        color="primary"
        variant="outlined"
        class="custom-styles-conv-settings__toggle"
        @update:model-value="setEnabledMode($event as TriMode)"
      >
        <v-btn
          v-for="item in triModeItems(
            pluginT('convModeInherit', { value: globalEnabledLabel }),
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

    <div>
      <div class="text-body-2 font-weight-medium mb-1">
        {{ pluginT('convSheetsSection') }}
      </div>
      <p
        v-if="globalSheets.length === 0"
        class="text-caption text-medium-emphasis mb-0"
      >
        {{ pluginT('convSheetsEmpty') }}
      </p>
      <div
        v-for="(sheet, index) in globalSheets"
        :key="String(sheet.id ?? index)"
        class="custom-styles-conv-settings__sheet rounded-lg border pa-3 mb-2"
      >
        <div class="text-body-2 font-weight-medium mb-2">
          {{ sheetTitle(sheet, index) }}
        </div>
        <v-btn-toggle
          v-if="typeof sheet.id === 'string' && sheet.id.trim()"
          :model-value="sheetMode(String(sheet.id))"
          mandatory
          divided
          density="compact"
          color="primary"
          variant="outlined"
          class="custom-styles-conv-settings__toggle"
          @update:model-value="setSheetMode(String(sheet.id), $event as TriMode)"
        >
          <v-btn
            v-for="item in triModeItems(
              pluginT('convModeInherit', {
                value: globalSheetEnabledLabel(sheet),
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
    </div>
  </div>
</template>

<style scoped>
.custom-styles-conv-settings__sheet {
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}

.custom-styles-conv-settings__toggle {
  flex-wrap: wrap;
  height: auto !important;
}
</style>
