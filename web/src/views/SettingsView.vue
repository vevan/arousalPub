<script setup lang="ts">
import { useLocaleStore } from '@/stores/locale'
import { usePreferencesStore } from '@/stores/preferences'
import { useThemeOklchStore } from '@/stores/theme-oklch'
import {
  componentsToOklchCss,
  oklchToHex,
  parseOklchComponents,
} from '@/theme/oklch-convert'
import { reapplyVuetifyThemeFromStorage } from '@/theme/reapply-vuetify-theme'
import {
  readStoredTheme,
  writeStoredTheme,
  type AppThemeMode,
} from '@/theme/theme-preference'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from 'vuetify'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { t } = useI18n()
const localeStore = useLocaleStore()
const { preference } = storeToRefs(localeStore)
const prefStore = usePreferencesStore()
const { writeChatPromptSnapshot, promptDebugMaxStored } = storeToRefs(prefStore)
const themeOklch = useThemeOklchStore()
const vuetifyTheme = useTheme()

const langItems = computed(() => [
  { value: 'auto' as const, title: t('settings.langAuto') },
  { value: 'en' as const, title: t('settings.langEnglish') },
  { value: 'zh' as const, title: t('settings.langChinese') },
])

const themeItems = computed(() => [
  { value: 'dark' as const, title: t('settings.themeDark') },
  { value: 'light' as const, title: t('settings.themeLight') },
])

const primaryDialogOpen = ref(false)
const dialogL = ref(0.65)
const dialogC = ref(0.15)
const dialogH = ref(250)

/** 切换即生效，并写入 localStorage */
const selectedTheme = computed({
  get: (): AppThemeMode => {
    const n = vuetifyTheme.global.name.value
    return n === 'light' ? 'light' : 'dark'
  },
  set: (v: AppThemeMode) => {
    vuetifyTheme.change(v)
    writeStoredTheme(v)
  },
})

function activeMode(): AppThemeMode {
  return vuetifyTheme.global.name.value === 'light' ? 'light' : 'dark'
}

/** 已保存主色（色块展示） */
const savedPrimaryHex = computed(() =>
  oklchToHex(themeOklch.mergedPrimaryOklch(activeMode())),
)

const dialogOklchCss = computed(() =>
  componentsToOklchCss(dialogL.value, dialogC.value, dialogH.value),
)
const dialogHex = computed(() => oklchToHex(dialogOklchCss.value))

const dialogPreviewStyle = computed(() => ({
  backgroundColor: dialogHex.value,
}))

function openPrimaryDialog() {
  const p = parseOklchComponents(
    themeOklch.mergedPrimaryOklch(activeMode()),
  )
  dialogL.value = p.l
  dialogC.value = p.c
  dialogH.value = p.h
  primaryDialogOpen.value = true
}

function closePrimaryDialog() {
  primaryDialogOpen.value = false
}

async function confirmPrimaryDialog() {
  themeOklch.savePrimary(activeMode(), dialogOklchCss.value)
  await reapplyVuetifyThemeFromStorage(vuetifyTheme)
  primaryDialogOpen.value = false
}

async function resetPrimary() {
  themeOklch.resetPrimary(activeMode())
  await reapplyVuetifyThemeFromStorage(vuetifyTheme)
}

onMounted(() => {
  themeOklch.reloadFromStorage()
  const stored = readStoredTheme()
  if (stored !== activeMode()) {
    vuetifyTheme.change(stored)
  }
})
</script>

<template>
  <div
    class="settings-page"
    :class="{
      'settings-page--embedded': embedded,
      'app-page-shell': !embedded,
    }"
  >
    <div class="settings-page-inner">
      <h1
        v-if="!embedded"
        class="text-h6 font-weight-medium mb-1"
      >
        {{ $t('settings.pageTitle') }}
      </h1>
      <p
        class="text-body-2 text-medium-emphasis"
        :class="embedded ? 'mb-4' : 'mb-6'"
      >
        {{ $t('settings.intro') }}
      </p>

      <v-card variant="outlined" class="pa-4 mb-4">
        <v-card-title class="text-subtitle-1 px-0 pt-0 pb-3">
          {{ $t('settings.language') }}
        </v-card-title>
        <v-select
          v-model="preference"
          :items="langItems"
          item-title="title"
          item-value="value"
          :label="$t('settings.language')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
        />
      </v-card>

      <v-card variant="outlined" class="pa-4 mb-4">
        <v-card-title class="text-subtitle-1 px-0 pt-0 pb-2">
          {{ $t('settings.debugSection') }}
        </v-card-title>
        <p class="text-body-2 text-medium-emphasis mb-3">
          {{ $t('settings.writeChatPromptHint') }}
        </p>
        <v-switch
          v-model="writeChatPromptSnapshot"
          :label="$t('settings.writeChatPromptSnapshot')"
          color="primary"
          hide-details
          density="comfortable"
        />
        <v-text-field
          v-model.number="promptDebugMaxStored"
          type="number"
          min="1"
          max="200"
          step="1"
          class="mt-2"
          density="comfortable"
          variant="outlined"
          :label="$t('settings.promptSnapshotMaxStored')"
          :hint="$t('settings.promptSnapshotMaxStoredHint')"
          persistent-hint
          hide-details="auto"
        />
      </v-card>

      <v-card variant="outlined" class="pa-4">
        <v-card-title class="text-subtitle-1 px-0 pt-0 pb-2">
          {{ $t('settings.themeSection') }}
        </v-card-title>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ $t('settings.themeColorsHint') }}
        </p>

        <v-select
          v-model="selectedTheme"
          :items="themeItems"
          item-title="title"
          item-value="value"
          :label="$t('settings.themeSelect')"
          density="comfortable"
          variant="outlined"
          class="mb-4"
          hide-details="auto"
        />

        <div class="d-flex align-center flex-wrap ga-4 mb-2">
          <button
            type="button"
            class="primary-swatch"
            :style="{ backgroundColor: savedPrimaryHex }"
            :aria-label="$t('settings.themePrimaryOpen')"
            @click="openPrimaryDialog"
          />
          <div class="d-flex flex-column">
            <span class="text-body-1 font-weight-medium">
              {{ $t('settings.themePrimary') }}
            </span>
            <span class="text-caption text-medium-emphasis font-mono">
              {{ savedPrimaryHex }}
            </span>
          </div>
          <v-spacer class="d-none d-sm-block" />
          <v-btn
            variant="text"
            size="small"
            color="error"
            class="align-self-center"
            @click="resetPrimary"
          >
            {{ $t('settings.themeResetPrimary') }}
          </v-btn>
        </div>

        <p class="text-caption text-medium-emphasis mt-2 mb-0">
          {{ $t('settings.themePrimaryHint') }}
        </p>
      </v-card>
    </div>
  </div>

  <v-dialog
    v-model="primaryDialogOpen"
    scrollable
    @keydown.esc="closePrimaryDialog"
  >
    <v-card>
      <v-card-title class="text-h6">
        {{ $t('settings.themePrimary') }}
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-4">
        <div
          class="primary-preview rounded-lg mb-4 border"
          :style="dialogPreviewStyle"
        />
        <p class="text-caption text-medium-emphasis mb-4 font-mono">
          {{ dialogOklchCss }} · {{ dialogHex }}
        </p>

        <div class="mb-2 text-caption text-medium-emphasis">
          L
        </div>
        <v-slider
          v-model="dialogL"
          :min="0"
          :max="1"
          :step="0.01"
          color="primary"
          density="compact"
          class="mb-3"
          hide-details
        />

        <div class="mb-2 text-caption text-medium-emphasis">
          C
        </div>
        <v-slider
          v-model="dialogC"
          :min="0"
          :max="0.37"
          :step="0.005"
          color="primary"
          density="compact"
          class="mb-3"
          hide-details
        />

        <div class="mb-2 text-caption text-medium-emphasis">
          H (°)
        </div>
        <v-slider
          v-model="dialogH"
          :min="0"
          :max="360"
          :step="1"
          color="primary"
          density="compact"
          hide-details
        />
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-3">
        <v-spacer />
        <v-btn variant="text" @click="closePrimaryDialog">
          {{ $t('settings.themeCancel') }}
        </v-btn>
        <v-btn color="primary" variant="flat" @click="confirmPrimaryDialog">
          {{ $t('settings.themeConfirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.settings-page {
  padding-block: 1.5rem;
  padding-inline: 0;
  width: 100%;
}

.settings-page-inner {
  width: 100%;
}

.settings-page--embedded {
  max-width: none;
  margin-inline: 0;
  padding-block: 1rem;
  padding-inline: 1rem;
}

.primary-swatch {
  width: 3rem;
  height: 3rem;
  border-radius: 0.5rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.2);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.primary-swatch:hover {
  transform: scale(1.04);
  box-shadow: 0 0.125rem 0.5rem rgba(0, 0, 0, 0.2);
}

.primary-swatch:focus-visible {
  outline: 0.125rem solid rgb(var(--v-theme-primary));
  outline-offset: 0.125rem;
}

.primary-preview {
  height: 5rem;
  width: 100%;
  min-height: 5rem;
}

.font-mono {
  font-family: ui-monospace, monospace;
}
</style>
