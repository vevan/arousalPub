<script setup lang="ts">
import { useLocaleStore } from '@/stores/locale'
import { bootstrapAppData } from '@/bootstrap/app-data'
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

type SettingsTab = 'system' | 'display' | 'lorebook' | 'history' | 'debug'

const { t } = useI18n()
const localeStore = useLocaleStore()
const { preference } = storeToRefs(localeStore)
const prefStore = usePreferencesStore()
const {
  writeChatPromptSnapshot,
  promptDebugMaxStored,
  lorebookRecursiveEnabled,
  lorebookMaxRecursionDepth,
  historyLimitEnabled,
  historyMaxTurns,
} = storeToRefs(prefStore)
const themeOklch = useThemeOklchStore()
const vuetifyTheme = useTheme()

const activeTab = ref<SettingsTab>('system')

const navItems = computed(() => [
  { id: 'system' as const, title: t('settings.navSystem'), icon: 'mdi-cog-outline' },
  { id: 'display' as const, title: t('settings.navDisplay'), icon: 'mdi-palette-outline' },
  { id: 'lorebook' as const, title: t('settings.navLorebook'), icon: 'mdi-book-open-page-variant-outline' },
  { id: 'history' as const, title: t('settings.navHistory'), icon: 'mdi-history' },
  { id: 'debug' as const, title: t('settings.navDebug'), icon: 'mdi-bug-outline' },
])

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
  void bootstrapAppData()
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
        class="text-h6 font-weight-medium mb-4"
      >
        {{ $t('settings.pageTitle') }}
      </h1>

      <div class="settings-layout">
        <nav
          class="settings-nav"
          :aria-label="$t('settings.pageTitle')"
        >
          <v-list
            density="compact"
            nav
            class="settings-nav-list py-0"
          >
            <v-list-item
              v-for="item in navItems"
              :key="item.id"
              :active="activeTab === item.id"
              :prepend-icon="item.icon"
              :title="item.title"
              rounded="lg"
              color="primary"
              @click="activeTab = item.id"
            />
          </v-list>
        </nav>

        <div class="settings-panel">
          <p class="text-body-2 text-medium-emphasis settings-panel-intro">
            {{ $t('settings.intro') }}
          </p>

          <section
            v-show="activeTab === 'system'"
            class="settings-section"
          >
            <h2 class="text-subtitle-1 font-weight-medium mb-3">
              {{ $t('settings.language') }}
            </h2>
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
          </section>

          <section
            v-show="activeTab === 'lorebook'"
            class="settings-section"
          >
            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.lorebookSection') }}
            </h2>
            <p class="text-body-2 text-medium-emphasis mb-4">
              {{ $t('settings.lorebookSectionHint') }}
            </p>
            <v-switch
              v-model="lorebookRecursiveEnabled"
              :label="$t('settings.loreRecursiveEnabled')"
              color="primary"
              hide-details
              density="comfortable"
            />
            <v-select
              v-model="lorebookMaxRecursionDepth"
              :items="[0, 1, 2, 3]"
              :label="$t('settings.loreMaxRecursionDepth')"
              class="mt-2"
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              :disabled="!lorebookRecursiveEnabled"
            />
            <p class="text-caption text-medium-emphasis mt-2 mb-0">
              {{ $t('settings.loreMaxRecursionDepthHint') }}
            </p>
          </section>

          <section
            v-show="activeTab === 'history'"
            class="settings-section"
          >
            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.historySection') }}
            </h2>
            <p class="text-body-2 text-medium-emphasis mb-4">
              {{ $t('settings.historySectionHint') }}
            </p>
            <v-switch
              v-model="historyLimitEnabled"
              :label="$t('settings.historyLimitEnabled')"
              color="primary"
              hide-details
              density="comfortable"
            />
            <v-text-field
              v-model.number="historyMaxTurns"
              type="number"
              min="1"
              max="200"
              step="1"
              class="mt-2"
              density="comfortable"
              variant="outlined"
              :label="$t('settings.historyMaxTurns')"
              :hint="$t('settings.historyMaxTurnsHint')"
              persistent-hint
              hide-details="auto"
              :disabled="!historyLimitEnabled"
            />
          </section>

          <section
            v-show="activeTab === 'debug'"
            class="settings-section"
          >
            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.debugSection') }}
            </h2>
            <p class="text-body-2 text-medium-emphasis mb-4">
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
          </section>

          <section
            v-show="activeTab === 'display'"
            class="settings-section"
          >
            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.themeSection') }}
            </h2>
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
          </section>
        </div>
      </div>
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
  padding-block: 0;
  padding-inline: 0;
}

.settings-layout {
  display: flex;
  align-items: stretch;
  min-height: 18rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 0.5rem;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

.settings-nav {
  flex: 0 0 11.5rem;
  border-inline-end: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  padding: 0.5rem;
}

.settings-nav-list {
  background: transparent;
}

.settings-panel {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem 1.25rem 1.25rem;
  max-height: min(70vh, 28rem);
}

.settings-page--embedded .settings-panel {
  max-height: min(65vh, 26rem);
}

.settings-panel-intro {
  margin-bottom: 1.25rem;
}

.settings-section {
  max-width: 36rem;
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

@media (max-width: 36rem) {
  .settings-layout {
    flex-direction: column;
  }

  .settings-nav {
    flex: 0 0 auto;
    border-inline-end: none;
    border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
    padding: 0.375rem 0.5rem;
  }

  .settings-nav-list {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 0.25rem;
  }

  .settings-nav-list :deep(.v-list-item) {
    flex: 0 0 auto;
    min-width: max-content;
  }

  .settings-panel {
    max-height: none;
  }
}
</style>
