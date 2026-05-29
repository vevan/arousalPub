<script setup lang="ts">
import { useLocaleStore } from '@/stores/locale'
import { bootstrapAppData } from '@/bootstrap/app-data'
import { useApiKeysStore } from '@/stores/apiKeys'
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
import {
  normalizeEmbeddingDimensions,
} from '@/utils/embedding-api-settings'
import {
  CHAT_FONT_SIZE_REM_MAX,
  CHAT_FONT_SIZE_REM_MIN,
} from '@/utils/chat-display-settings'
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
const apiKeysStore = useApiKeysStore()
const EMBED_KEY_DIRECT = '__direct__'
const {
  writeChatPromptSnapshot,
  promptDebugMaxStored,
  lorebookRecursiveEnabled,
  lorebookMaxRecursionDepth,
  lorebookVectorEnabled,
  lorebookVectorTopK,
  historyLimitEnabled,
  historyMaxTurns,
  memoryEnabled,
  memoryTopK,
  embeddingBaseUrl,
  embeddingApiKey,
  embeddingApiKeyId,
  embeddingModel,
  embeddingDimensions,
  chatFontSizeRem,
} = storeToRefs(prefStore)

const embeddingApiKeySelectItems = computed(() => [
  { value: EMBED_KEY_DIRECT, title: t('conn.apiKeyDirectOption') },
  ...apiKeysStore.selectItems,
])
const embeddingApiKeySelectValue = computed<string>({
  get: () => embeddingApiKeyId.value ?? EMBED_KEY_DIRECT,
  set: (v) => {
    prefStore.setEmbeddingApiKeyId(v === EMBED_KEY_DIRECT ? null : v)
  },
})
const embeddingApiKeyEditable = computed(() => embeddingApiKeyId.value == null)

const embeddingDimensionsEditable = computed({
  get: () => embeddingDimensions.value ?? '',
  set: (v: string | number) => {
    if (v === '' || v === null) {
      prefStore.setEmbeddingDimensions(null)
      return
    }
    const n = normalizeEmbeddingDimensions(
      typeof v === 'number' ? v : Number.parseInt(String(v), 10),
    )
    prefStore.setEmbeddingDimensions(n)
  },
})

const DEFAULT_EMBEDDING_TEST_TEXT = '这是一句用于测试 embedding 的短句。'
const embeddingTestText = ref(DEFAULT_EMBEDDING_TEST_TEXT)
const embeddingTestLoading = ref(false)
const embeddingTestError = ref<string | null>(null)
const embeddingTestDetail = ref<string | null>(null)
const embeddingTestResult = ref<{
  model: string
  dimensions: number
  requestedDimensions: number | null
  requestUrl: string
  vector: number[]
} | null>(null)

const embeddingTestVectorPreview = computed(() => {
  const v = embeddingTestResult.value?.vector
  if (!v?.length) return ''
  return JSON.stringify(v, null, 2)
})

async function runEmbeddingTest(): Promise<void> {
  embeddingTestLoading.value = true
  embeddingTestError.value = null
  embeddingTestDetail.value = null
  embeddingTestResult.value = null
  try {
    const res = await fetch('/api/embedding/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: embeddingTestText.value,
        embeddingApi: {
          baseUrl: embeddingBaseUrl.value,
          apiKey: embeddingApiKeyId.value ? '' : embeddingApiKey.value,
          apiKeyId: embeddingApiKeyId.value,
          embeddingModel: embeddingModel.value,
          embeddingDimensions: embeddingDimensions.value,
        },
      }),
    })
    const j = (await res.json()) as {
      ok?: boolean
      error?: string
      detail?: string
      model?: string
      dimensions?: number
      requestUrl?: string
      vector?: number[]
    }
    if (!res.ok || !j.ok) {
      embeddingTestError.value = j.error ?? t('settings.embeddingTestFailed')
      embeddingTestDetail.value = j.detail ?? null
      return
    }
    if (!Array.isArray(j.vector) || typeof j.dimensions !== 'number') {
      embeddingTestError.value = t('settings.embeddingTestInvalidResponse')
      return
    }
    embeddingTestResult.value = {
      model: j.model ?? embeddingModel.value,
      dimensions: j.dimensions,
      requestedDimensions: embeddingDimensions.value,
      requestUrl: j.requestUrl ?? '',
      vector: j.vector,
    }
  } catch (e) {
    embeddingTestError.value =
      e instanceof Error ? e.message : t('settings.embeddingTestFailed')
  } finally {
    embeddingTestLoading.value = false
  }
}
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
  'background-color': dialogHex.value,
}))

const primarySwatchStyle = computed(() => ({
  'background-color': savedPrimaryHex.value,
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

            <v-divider class="my-6" />

            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.chatFontSizeSection') }}
            </h2>
            <p class="text-body-2 text-medium-emphasis mb-4">
              {{ $t('settings.chatFontSizeHint') }}
            </p>
            <div class="d-flex align-center ga-4">
              <v-slider
                v-model="chatFontSizeRem"
                :min="CHAT_FONT_SIZE_REM_MIN"
                :max="CHAT_FONT_SIZE_REM_MAX"
                :step="0.0625"
                color="primary"
                class="flex-grow-1"
                hide-details
              />
              <span class="text-body-2 font-mono chat-font-size-readout">
                {{ chatFontSizeRem }}rem
              </span>
            </div>
            <p class="text-caption text-medium-emphasis mt-2 mb-0">
              {{
                $t('settings.chatFontSizePxHint', {
                  px: Math.round(chatFontSizeRem * 16),
                })
              }}
            </p>
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
            <v-divider class="my-4" />
            <v-switch
              v-model="lorebookVectorEnabled"
              :label="$t('settings.loreVectorEnabled')"
              color="primary"
              hide-details
              density="comfortable"
            />
            <v-text-field
              v-model.number="lorebookVectorTopK"
              type="number"
              min="1"
              max="20"
              step="1"
              class="mt-2"
              density="comfortable"
              variant="outlined"
              :label="$t('settings.loreVectorTopK')"
              :hint="$t('settings.loreVectorTopKHint')"
              persistent-hint
              hide-details="auto"
              :disabled="!lorebookVectorEnabled"
            />
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
            <v-divider class="my-4" />
            <h3 class="text-body-1 font-weight-medium mb-2">
              {{ $t('settings.embeddingApiSection') }}
            </h3>
            <p class="text-body-2 text-medium-emphasis mb-4">
              {{ $t('settings.embeddingApiSectionHint') }}
            </p>
            <v-text-field
              v-model="embeddingBaseUrl"
              :label="$t('settings.embeddingBaseUrl')"
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="mb-2"
            />
            <v-select
              v-model="embeddingApiKeySelectValue"
              :items="embeddingApiKeySelectItems"
              item-title="title"
              item-value="value"
              :label="$t('conn.apiKeyAlias')"
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="mb-2"
            />
            <v-text-field
              v-model="embeddingApiKey"
              :label="$t('conn.apiKey')"
              type="password"
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="mb-2"
              :disabled="!embeddingApiKeyEditable"
            />
            <v-text-field
              v-model="embeddingModel"
              :label="$t('settings.embeddingModel')"
              :hint="$t('settings.embeddingModelHint')"
              persistent-hint
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="mb-2"
            />
            <v-text-field
              v-model="embeddingDimensionsEditable"
              type="number"
              min="1"
              max="4096"
              step="1"
              clearable
              :label="$t('settings.embeddingDimensions')"
              :hint="$t('settings.embeddingDimensionsHint')"
              persistent-hint
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="mb-2"
            />
            <v-text-field
              v-model="embeddingTestText"
              :label="$t('settings.embeddingTestText')"
              :hint="$t('settings.embeddingTestTextHint')"
              persistent-hint
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="mb-2"
            />
            <v-btn
              color="primary"
              variant="tonal"
              :loading="embeddingTestLoading"
              :disabled="embeddingTestLoading"
              @click="runEmbeddingTest"
            >
              {{ $t('settings.embeddingTestButton') }}
            </v-btn>
            <v-alert
              v-if="embeddingTestError"
              type="error"
              variant="tonal"
              density="compact"
              class="mt-3"
            >
              <div>{{ embeddingTestError }}</div>
              <pre
                v-if="embeddingTestDetail"
                class="text-caption mt-2 mb-0 embedding-test-detail"
              >{{ embeddingTestDetail }}</pre>
            </v-alert>
            <v-sheet
              v-if="embeddingTestResult"
              color="surface-variant"
              rounded="lg"
              class="pa-3 mt-3"
            >
              <div class="text-body-2 text-medium-emphasis mb-1">
                {{ $t('settings.embeddingTestModel') }}: {{ embeddingTestResult.model }}
              </div>
              <div
                v-if="embeddingTestResult.requestedDimensions != null"
                class="text-body-2 text-medium-emphasis mb-1"
              >
                {{ $t('settings.embeddingTestRequestedDimensions') }}:
                {{ embeddingTestResult.requestedDimensions }}
              </div>
              <div class="text-body-2 text-medium-emphasis mb-1">
                {{ $t('settings.embeddingTestDimensions') }}: {{ embeddingTestResult.dimensions }}
              </div>
              <div class="text-body-2 text-medium-emphasis mb-2 text-truncate">
                {{ $t('settings.embeddingTestRequestUrl') }}: {{ embeddingTestResult.requestUrl }}
              </div>
              <div class="text-caption text-medium-emphasis mb-1">
                {{ $t('settings.embeddingTestVector') }}
              </div>
              <pre class="embedding-test-vector">{{ embeddingTestVectorPreview }}</pre>
            </v-sheet>
            <h3 class="text-body-1 font-weight-medium mb-2 mt-4">
              {{ $t('settings.memorySection') }}
            </h3>
            <p class="text-body-2 text-medium-emphasis mb-4">
              {{ $t('settings.memorySectionHint') }}
            </p>
            <v-switch
              v-model="memoryEnabled"
              :label="$t('settings.memoryEnabled')"
              color="primary"
              hide-details
              density="comfortable"
            />
            <v-text-field
              v-model.number="memoryTopK"
              type="number"
              min="1"
              max="20"
              step="1"
              class="mt-2"
              density="comfortable"
              variant="outlined"
              :label="$t('settings.memoryTopK')"
              :hint="$t('settings.memoryTopKHint')"
              persistent-hint
              hide-details="auto"
              :disabled="!memoryEnabled"
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
                :style="primarySwatchStyle"
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
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.settings-page--embedded .settings-page-inner {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.settings-page--embedded .settings-layout {
  flex: 1 1 auto;
  min-height: 0;
}

.settings-page--embedded .settings-panel {
  max-height: none;
  flex: 1 1 auto;
  min-height: 0;
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
}

.settings-panel-intro {
  margin-bottom: 1.25rem;
}

.settings-page--embedded .settings-section {
  max-width: none;
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

.embedding-test-vector,
.embedding-test-detail {
  margin: 0;
  max-height: 16rem;
  overflow: auto;
  font-size: 0.75rem;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>

