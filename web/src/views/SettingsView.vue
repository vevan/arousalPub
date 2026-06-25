<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { apiFetch } from '@/utils/api-fetch'
import { translateApiError } from '@/utils/api-error-message'
import { userAvatarUrl } from '@/utils/authenticated-media-url'
import { useApiKeysStore } from '@/stores/apiKeys'
import {
  HYBRID_FTS_PROFILES,
  profileRequiresDict,
  type HybridFtsDictVariant,
  type HybridFtsProfile,
} from '@/utils/hybrid-fts-settings'
import { usePreferencesStore } from '@/stores/preferences'
import {
  stripBlockTagsFromText,
  stripBlockTagsToText,
} from '@/utils/memory-settings'
import { useThemeOklchStore } from '@/stores/theme-oklch'
import PluginSettingsPanel from '@/components/settings/PluginSettingsPanel.vue'
import HybridFtsSwitchDialog from '@/components/settings/HybridFtsSwitchDialog.vue'
import BudgetTrimSettingsPanel from '@/components/settings/BudgetTrimSettingsPanel.vue'
import RegexRulesSettingsPanel from '@/components/settings/RegexRulesSettingsPanel.vue'
import { useRegexRulesStore } from '@/stores/regex-rules'
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
import {
  CHUNK_TURNS_PER_FILE_MAX,
  CHUNK_TURNS_PER_FILE_MIN,
} from '@/utils/chunk-settings'
import {
  readHomeCharacterSourceDefault,
  readHomeListModeDefault,
  writeHomeCharacterSourceDefault,
  writeHomeListModeDefault,
  type HomeCharacterSource,
  type HomeListMode,
} from '@/utils/home-preferences'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from 'vuetify'

const props = withDefaults(
  defineProps<{
    embedded?: boolean
    initialTab?: SettingsTab
    /** 设置对话框每次打开递增，用于 embedded 下刷新账号统计 */
    openCount?: number
  }>(),
  { embedded: false, initialTab: 'system', openCount: 0 },
)

const emit = defineEmits<{ logout: [] }>()

type SettingsTab = 'system' | 'display' | 'account' | 'lorebook' | 'vectorRecall' | 'history' | 'budgetTrim' | 'regexRules' | 'plugins' | 'debug'

const { t } = useI18n()

function accountApiErrorMessage(codeOrMsg: string): string {
  return translateApiError(codeOrMsg)
}
const auth = useAuthStore()
const localeStore = useLocaleStore()
const { preference } = storeToRefs(localeStore)
const prefStore = usePreferencesStore()
const { markEmbeddingApiKeyDirty, flushEmbeddingToServer } = prefStore
const apiKeysStore = useApiKeysStore()
const regexRulesStore = useRegexRulesStore()
const EMBED_KEY_DIRECT = '__direct__'
const {
  writeChatPromptSnapshot,
  promptDebugMaxStored,
  lorebookRecursiveEnabled,
  lorebookMaxRecursionDepth,
  lorebookVectorEnabled,
  lorebookVectorTopK,
  lorebookKeywordTopK,
  historyLimitEnabled,
  historyMaxTurns,
  memoryEnabled,
  memoryTopK,
  memoryStripPluginBlocks,
  memoryStripBlockTags,
  memoryRecallFuseLastAssistant,
  memoryRecallUserWeight,
  hybridFtsProfile,
  hybridFtsDictVariant,
  budgetTrimSettings,
  embeddingBaseUrl,
  embeddingApiKey,
  embeddingApiKeyId,
  embeddingApiKeyDirty,
  isEmbeddingKeyConfigured,
  embeddingModel,
  embeddingDimensions,
  chatFontSizeRem,
  composerEnterMode,
  chunkTurnsPerFile,
} = storeToRefs(prefStore)

function onMemoryStripBlockTagsInput(v: string | null) {
  memoryStripBlockTags.value = stripBlockTagsFromText(String(v ?? ''))
}

const homeListModeDefault = ref<HomeListMode>(readHomeListModeDefault())
const homeCharacterSourceDefault = ref<HomeCharacterSource>(
  readHomeCharacterSourceDefault(),
)

watch(homeListModeDefault, (v) => {
  writeHomeListModeDefault(v)
})

watch(homeCharacterSourceDefault, (v) => {
  writeHomeCharacterSourceDefault(v)
})

const homeListModeItems = computed(() => [
  {
    value: 'conversations' as const,
    title: t('settings.homeListModeConversations'),
  },
  {
    value: 'characters' as const,
    title: t('settings.homeListModeCharacters'),
  },
])

const homeCharacterSourceItems = computed(() => [
  {
    value: 'usedInChats' as const,
    title: t('settings.homeCharacterSourceUsed'),
  },
  {
    value: 'allLibrary' as const,
    title: t('settings.homeCharacterSourceAll'),
  },
])

const composerEnterModeItems = computed(() => [
  {
    value: 'enter-send' as const,
    title: t('settings.composerEnterSend'),
  },
  {
    value: 'ctrl-enter-send' as const,
    title: t('settings.composerCtrlEnterSend'),
  },
])

const hybridFtsProfileItems = computed(() =>
  HYBRID_FTS_PROFILES.map((value: HybridFtsProfile) => ({
    value,
    title: t(`settings.hybridFtsProfile.${value}`),
  })),
)

const hybridFtsSwitchOpen = ref(false)
const pendingHybridFtsProfile = ref<HybridFtsProfile>(hybridFtsProfile.value)

function onHybridFtsProfilePick(next: HybridFtsProfile): void {
  if (next === hybridFtsProfile.value) return
  pendingHybridFtsProfile.value = next
  hybridFtsSwitchOpen.value = true
}

function openHybridFtsManageDialog(): void {
  pendingHybridFtsProfile.value = hybridFtsProfile.value
  hybridFtsSwitchOpen.value = true
}

async function onHybridFtsSwitchConfirm(payload: {
  profile: HybridFtsProfile
  dictVariant: HybridFtsDictVariant | null
}): Promise<void> {
  try {
    await prefStore.confirmHybridFtsChange(payload)
  } catch {
    /* 设置页可重试 */
  }
}

function onHybridFtsSwitchCancel(): void {
  pendingHybridFtsProfile.value = hybridFtsProfile.value
}

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

type BuildInfo = {
  version: string | null
  gitCommit: string | null
  gitCommitDate: string | null
  builtAt: string | null
}

const buildInfo = ref<BuildInfo | null>(null)
const buildInfoLoading = ref(false)

const buildVersionDisplay = computed(() => {
  const raw = buildInfo.value?.version ?? buildInfo.value?.gitCommitDate
  if (!raw) return t('settings.buildVersionUnknown')
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
})

const buildVersionHint = computed(() => {
  const commit = buildInfo.value?.gitCommit?.slice(0, 7)
  if (commit) return t('settings.buildCommitHint', { commit })
  return t('settings.buildVersionHint')
})

async function loadBuildInfo() {
  buildInfoLoading.value = true
  try {
    const res = await apiFetch('/api/build-info')
    if (res.ok) {
      buildInfo.value = (await res.json()) as BuildInfo
    }
  } finally {
    buildInfoLoading.value = false
  }
}
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

const activeTab = ref<SettingsTab>(props.initialTab)

watch(
  () => props.initialTab,
  (tab) => {
    if (tab) activeTab.value = tab
  },
)

const navItems = computed(() => [
  { id: 'system' as const, title: t('settings.navSystem'), icon: 'mdi-cog-outline' },
  { id: 'account' as const, title: t('settings.navAccount'), icon: 'mdi-account-outline' },
  { id: 'display' as const, title: t('settings.navDisplay'), icon: 'mdi-palette-outline' },
  { id: 'history' as const, title: t('settings.navHistory'), icon: 'mdi-history' },
  { id: 'lorebook' as const, title: t('settings.navLorebook'), icon: 'mdi-book-open-page-variant-outline' },
  { id: 'vectorRecall' as const, title: t('settings.navVectorRecall'), icon: 'mdi-database-search-outline' },
  { id: 'budgetTrim' as const, title: t('settings.navBudgetTrim'), icon: 'mdi-scissors-cutting' },
  { id: 'regexRules' as const, title: t('settings.navRegexRules'), icon: 'mdi-regex' },
  { id: 'plugins' as const, title: t('settings.navPlugins'), icon: 'mdi-puzzle-outline' },
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

const accountStats = ref<{
  bytes: number
  conversationCount: number
  dataDir: string
} | null>(null)
const accountStatsLoading = ref(false)
const pwdCurrent = ref('')
const pwdNew = ref('')
const pwdBusy = ref(false)
const pwdMsg = ref('')
const deleteConfirmUsername = ref('')
const deleteBusy = ref(false)
const avatarBusy = ref(false)
const defaultUserBusy = ref(false)

async function loadAccountStats() {
  accountStatsLoading.value = true
  try {
    const res = await apiFetch('/api/users/me/stats')
    if (!res.ok) throw new Error(String(res.status))
    accountStats.value = (await res.json()) as typeof accountStats.value
  } catch {
    accountStats.value = null
  } finally {
    accountStatsLoading.value = false
  }
}

async function changePassword() {
  pwdMsg.value = ''
  pwdBusy.value = true
  try {
    const res = await apiFetch('/api/users/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: pwdCurrent.value,
        newPassword: pwdNew.value,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const raw =
        typeof data.error === 'string' ? data.error : 'password_change_failed'
      throw new Error(accountApiErrorMessage(raw))
    }
    pwdCurrent.value = ''
    pwdNew.value = ''
    pwdMsg.value = t('settings.accountPasswordOk')
    if ((data as { requireLogin?: boolean }).requireLogin) {
      emit('logout')
    }
  } catch (e) {
    pwdMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    pwdBusy.value = false
  }
}

async function onDefaultUserToggle(enabled: boolean | null) {
  if (enabled === null) return
  defaultUserBusy.value = true
  pwdMsg.value = ''
  try {
    await auth.setDeviceDefault(enabled)
    pwdMsg.value = enabled
      ? t('settings.accountDefaultUserOn')
      : t('settings.accountDefaultUserOff')
  } catch (e) {
    pwdMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    defaultUserBusy.value = false
  }
}

async function uploadAvatar(file: File) {
  avatarBusy.value = true
  try {
    const fd = new FormData()
    fd.append('avatar', file)
    const res = await apiFetch('/api/users/me/avatar', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : '失败')
    }
    await auth.fetchMe()
  } finally {
    avatarBusy.value = false
  }
}

function onAvatarPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void uploadAvatar(file)
  input.value = ''
}

async function deleteAccount() {
  deleteBusy.value = true
  try {
    const res = await apiFetch('/api/users/me', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmUsername: deleteConfirmUsername.value }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const raw =
        typeof data.error === 'string' ? data.error : 'delete_account_failed'
      throw new Error(accountApiErrorMessage(raw))
    }
    emit('logout')
  } catch (e) {
    pwdMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    deleteBusy.value = false
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

watch(activeTab, (tab) => {
  if (tab === 'account') void loadAccountStats()
  if (tab === 'regexRules') void regexRulesStore.loadFromServer()
  if (tab === 'debug' && !buildInfo.value && !buildInfoLoading.value) {
    void loadBuildInfo()
  }
}, { immediate: true })

watch(
  () => props.openCount,
  () => {
    if (props.embedded && activeTab.value === 'account') void loadAccountStats()
  },
)

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
  if (activeTab.value === 'debug') {
    void loadBuildInfo()
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

            <v-divider class="my-6" />

            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.composerEnterSection') }}
            </h2>
            <p class="text-body-2 text-medium-emphasis mb-3">
              {{ $t('settings.composerEnterHint') }}
            </p>
            <v-radio-group
              v-model="composerEnterMode"
              inline
              class="settings-composer-enter-group"
              density="comfortable"
              hide-details
            >
              <v-radio
                v-for="item in composerEnterModeItems"
                :key="item.value"
                :label="item.title"
                :value="item.value"
              />
            </v-radio-group>

            <v-divider class="my-6" />

            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.chunkSection') }}
            </h2>
            <p class="text-body-2 text-medium-emphasis mb-3">
              {{ $t('settings.chunkSectionHint') }}
            </p>
            <v-text-field
              v-model.number="chunkTurnsPerFile"
              type="number"
              :min="CHUNK_TURNS_PER_FILE_MIN"
              :max="CHUNK_TURNS_PER_FILE_MAX"
              step="1"
              density="comfortable"
              variant="outlined"
              :label="$t('settings.chunkTurnsPerFile')"
              :hint="$t('settings.chunkTurnsPerFileHint')"
              persistent-hint
              hide-details="auto"
            />
          </section>

          <section
            v-show="activeTab === 'account'"
            class="settings-section"
          >
            <h2 class="text-subtitle-1 font-weight-medium mb-3">
              {{ $t('settings.accountSection') }}
            </h2>
            <div v-if="auth.user" class="d-flex align-center ga-3 mb-4">
              <v-avatar size="64" rounded="lg">
                <v-img :src="userAvatarUrl(auth.user.id) ?? undefined" cover />
              </v-avatar>
              <div>
                <div class="text-body-1 font-weight-medium">
                  {{ auth.user.displayName || auth.user.username }}
                </div>
                <div class="text-caption text-medium-emphasis font-mono">
                  @{{ auth.user.username }} · {{ auth.user.id }}
                </div>
              </div>
            </div>
            <v-btn
              variant="outlined"
              size="small"
              class="mb-4"
              :loading="avatarBusy"
              @click="($refs.avatarInput as HTMLInputElement)?.click()"
            >
              {{ $t('settings.accountChangeAvatar') }}
            </v-btn>
            <input
              ref="avatarInput"
              type="file"
              accept="image/png"
              class="d-none"
              @change="onAvatarPick"
            >

            <div
              v-if="auth.isSeedAdmin && auth.adminConsoleUrl"
              class="mb-4"
            >
              <p class="text-body-2 text-medium-emphasis mb-2">
                {{ $t('settings.accountAdminConsoleHint') }}
              </p>
              <v-btn
                :href="auth.adminConsoleUrl"
                target="_blank"
                rel="noopener noreferrer"
                variant="outlined"
                size="small"
                prepend-icon="mdi-shield-account-outline"
              >
                {{ $t('settings.accountAdminConsole') }}
              </v-btn>
            </div>

            <v-divider class="my-4" />

            <h3 class="text-subtitle-2 font-weight-medium mb-2">
              {{ $t('settings.accountPassword') }}
            </h3>
            <v-text-field
              v-model="pwdCurrent"
              :label="t('settings.accountCurrentPassword')"
              type="password"
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="mb-2"
            />
            <v-text-field
              v-model="pwdNew"
              :label="t('settings.accountNewPassword')"
              type="password"
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="mb-2"
            />
            <v-btn
              color="primary"
              variant="tonal"
              :loading="pwdBusy"
              @click="changePassword"
            >
              {{ $t('settings.accountPasswordSubmit') }}
            </v-btn>

            <v-divider class="my-4" />

            <h3 class="text-subtitle-2 font-weight-medium mb-2">
              {{ $t('settings.accountStorage') }}
            </h3>
            <div v-if="accountStatsLoading" class="account-stats text-body-2 mb-4">
              {{ $t('settings.accountStatsLoading') }}
            </div>
            <div v-else-if="accountStats" class="account-stats text-body-2 mb-4">
              <p class="account-stats__line">
                {{ $t('settings.accountStatsSize', { size: formatBytes(accountStats.bytes) }) }}
              </p>
              <p class="account-stats__line">
                {{ $t('settings.accountStatsChats', { n: accountStats.conversationCount }) }}
              </p>
              <p class="account-stats__path text-caption text-medium-emphasis">
                {{ accountStats.dataDir }}
              </p>
            </div>

            <v-switch
              :model-value="auth.isDefaultUserOnDevice"
              :label="t('settings.accountDefaultUser')"
              :hint="t('settings.accountDefaultUserHint')"
              persistent-hint
              color="primary"
              density="comfortable"
              class="mb-2"
              :disabled="defaultUserBusy"
              :loading="defaultUserBusy"
              @update:model-value="onDefaultUserToggle"
            />
            <v-btn variant="outlined" color="warning" class="mb-4" @click="emit('logout')">
              {{ $t('settings.accountLogout') }}
            </v-btn>

            <v-divider class="my-4" />

            <h3 class="text-subtitle-2 font-weight-medium mb-2 text-error">
              {{ $t('settings.accountDelete') }}
            </h3>
            <p class="text-body-2 text-medium-emphasis mb-2">
              {{ $t('settings.accountDeleteHint') }}
            </p>
            <v-text-field
              v-model="deleteConfirmUsername"
              :label="t('settings.accountDeleteConfirm')"
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="mb-2"
            />
            <v-btn
              color="error"
              variant="flat"
              :loading="deleteBusy"
              :disabled="!deleteConfirmUsername.trim()"
              @click="deleteAccount"
            >
              {{ $t('settings.accountDeleteSubmit') }}
            </v-btn>
            <p v-if="pwdMsg" class="text-caption mt-3">{{ pwdMsg }}</p>
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
            v-show="activeTab === 'vectorRecall'"
            class="settings-section"
          >
            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.vectorRecallSection') }}
            </h2>
            <p class="text-body-2 text-medium-emphasis mb-2">
              {{ $t('settings.vectorRecallSectionHint') }}
            </p>

            <v-sheet
              class="settings-vector-recall-block"
              rounded="lg"
              border
            >
              <header class="settings-vector-recall-block__header">
                <h3 class="settings-vector-recall-block__title">
                  {{ $t('settings.memorySection') }}
                </h3>
                <p class="settings-vector-recall-block__hint text-body-2 text-medium-emphasis">
                  {{ $t('settings.memorySectionHint') }}
                </p>
              </header>
              <v-switch
                v-model="memoryEnabled"
                :label="$t('settings.memoryEnabled')"
                color="primary"
                hide-details
                density="compact"
              />
              <v-text-field
                v-model.number="memoryTopK"
                type="number"
                min="1"
                max="20"
                step="1"
                class="mt-3"
                density="comfortable"
                variant="outlined"
                :label="$t('settings.memoryTopK')"
                :hint="$t('settings.memoryTopKHint')"
                persistent-hint
                hide-details="auto"
                :disabled="!memoryEnabled"
              />
              <div
                class="settings-vr-field"
                :class="{ 'settings-vr-field--muted': !memoryEnabled || !memoryStripPluginBlocks }"
              >
                <v-switch
                  v-model="memoryStripPluginBlocks"
                  :label="$t('settings.memoryStripCustomElements')"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!memoryEnabled"
                />
                <p class="settings-vr-field__hint text-caption text-medium-emphasis">
                  {{ $t('settings.memoryStripCustomElementsHint') }}
                </p>
                <v-text-field
                  v-show="memoryStripPluginBlocks"
                  :model-value="stripBlockTagsToText(memoryStripBlockTags)"
                  class="settings-vr-field__control"
                  density="comfortable"
                  variant="outlined"
                  :label="$t('settings.memoryStripBlockTags')"
                  :hint="$t('settings.memoryStripBlockTagsHint')"
                  persistent-hint
                  hide-details="auto"
                  :disabled="!memoryEnabled || !memoryStripPluginBlocks"
                  @update:model-value="onMemoryStripBlockTagsInput"
                />
              </div>
              <div
                class="settings-vr-field"
                :class="{ 'settings-vr-field--muted': !memoryEnabled }"
              >
                <v-switch
                  v-model="memoryRecallFuseLastAssistant"
                  :label="$t('settings.memoryRecallFuseAssistant')"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!memoryEnabled"
                />
                <p class="settings-vr-field__hint text-caption text-medium-emphasis">
                  {{ $t('settings.memoryRecallFuseAssistantHint') }}
                </p>
                <v-slider
                  v-model="memoryRecallUserWeight"
                  class="settings-vr-field__control"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  thumb-label
                  :label="$t('settings.memoryRecallUserWeight')"
                  :hint="$t('settings.memoryRecallUserWeightHint')"
                  persistent-hint
                  hide-details="auto"
                  density="compact"
                  :disabled="!memoryEnabled || !memoryRecallFuseLastAssistant"
                />
              </div>
              <v-select
                :model-value="hybridFtsProfile"
                :items="hybridFtsProfileItems"
                item-title="title"
                item-value="value"
                :label="$t('settings.hybridFtsProfileLabel')"
                :hint="$t('settings.hybridFtsProfileHint')"
                persistent-hint
                density="comfortable"
                variant="outlined"
                hide-details="auto"
                class="mt-4 mb-2"
                @update:model-value="onHybridFtsProfilePick"
              />
              <v-btn
                v-if="profileRequiresDict(hybridFtsProfile)"
                variant="outlined"
                color="primary"
                size="small"
                class="settings-vr-dict-btn mt-2"
                prepend-icon="mdi-book-open-variant-outline"
                @click="openHybridFtsManageDialog"
              >
                {{ $t('settings.hybridFtsManageDict') }}
              </v-btn>
            </v-sheet>

            <v-sheet
              class="settings-vector-recall-block"
              rounded="lg"
              border
            >
              <header class="settings-vector-recall-block__header">
                <h3 class="settings-vector-recall-block__title">
                  {{ $t('settings.loreVectorRecallSection') }}
                </h3>
                <p class="settings-vector-recall-block__hint text-body-2 text-medium-emphasis">
                  {{ $t('settings.loreVectorRecallSectionHint') }}
                </p>
              </header>
              <v-text-field
                v-model.number="lorebookKeywordTopK"
                type="number"
                min="1"
                max="64"
                step="1"
                density="comfortable"
                variant="outlined"
                :label="$t('settings.loreKeywordTopK')"
                :hint="$t('settings.loreKeywordTopKHint')"
                persistent-hint
                hide-details="auto"
              />
              <v-switch
                v-model="lorebookVectorEnabled"
                class="mt-4"
                :label="$t('settings.loreVectorEnabled')"
                color="primary"
                hide-details
                density="compact"
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
            </v-sheet>

            <v-sheet
              class="settings-vector-recall-block"
              rounded="lg"
              border
            >
              <header class="settings-vector-recall-block__header">
                <h3 class="settings-vector-recall-block__title">
                  {{ $t('settings.embeddingApiSection') }}
                </h3>
                <p class="settings-vector-recall-block__hint text-body-2 text-medium-emphasis">
                  {{ $t('settings.embeddingApiSectionHint') }}
                </p>
              </header>
              <v-text-field
                v-model="embeddingBaseUrl"
                :label="$t('settings.embeddingBaseUrl')"
                density="comfortable"
                variant="outlined"
                hide-details="auto"
                class="mb-2"
                @blur="void flushEmbeddingToServer()"
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
                :placeholder="isEmbeddingKeyConfigured && !embeddingApiKeyDirty && !embeddingApiKey.trim()
                  ? '••••••'
                  : undefined"
                @update:model-value="markEmbeddingApiKeyDirty()"
                @blur="void flushEmbeddingToServer()"
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
                @blur="void flushEmbeddingToServer()"
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
            </v-sheet>

            <HybridFtsSwitchDialog
              v-model="hybridFtsSwitchOpen"
              :pending-profile="pendingHybridFtsProfile"
              :current-profile="hybridFtsProfile"
              :current-dict-variant="hybridFtsDictVariant"
              @confirm="onHybridFtsSwitchConfirm"
              @cancel="onHybridFtsSwitchCancel"
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
          </section>

          <section
            v-show="activeTab === 'budgetTrim'"
            class="settings-section"
          >
            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.budgetTrimSection') }}
            </h2>
            <p class="text-body-2 text-medium-emphasis mb-4">
              {{ $t('settings.budgetTrimSectionHint') }}
            </p>
            <BudgetTrimSettingsPanel v-model="budgetTrimSettings" />
          </section>

          <RegexRulesSettingsPanel v-show="activeTab === 'regexRules'" />

          <PluginSettingsPanel v-show="activeTab === 'plugins'" />

          <section
            v-show="activeTab === 'debug'"
            class="settings-section"
          >
            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.debugSection') }}
            </h2>
            <v-text-field
              :model-value="buildVersionDisplay"
              :label="$t('settings.buildVersion')"
              :hint="buildVersionHint"
              persistent-hint
              density="comfortable"
              variant="outlined"
              class="mb-4"
              readonly
              hide-details="auto"
              :loading="buildInfoLoading"
            />
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

            <v-divider class="my-6" />

            <h2 class="text-subtitle-1 font-weight-medium mb-2">
              {{ $t('settings.homeSection') }}
            </h2>
            <p class="text-body-2 text-medium-emphasis mb-4">
              {{ $t('settings.homeSectionHint') }}
            </p>

            <v-select
              v-model="homeListModeDefault"
              :items="homeListModeItems"
              item-title="title"
              item-value="value"
              :label="$t('settings.homeListModeDefault')"
              density="comfortable"
              variant="outlined"
              class="mb-4"
              hide-details="auto"
            />

            <v-select
              v-model="homeCharacterSourceDefault"
              :items="homeCharacterSourceItems"
              item-title="title"
              item-value="value"
              :label="$t('settings.homeCharacterSourceDefault')"
              :hint="$t('settings.homeCharacterSourceHint')"
              persistent-hint
              density="comfortable"
              variant="outlined"
              hide-details="auto"
            />
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

.settings-vector-recall-block {
  padding: 1rem 1.125rem 1.125rem;
  margin-top: 1rem;
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.settings-vector-recall-block__header {
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.settings-vector-recall-block__title {
  margin: 0;
  padding-left: 0.625rem;
  border-left: 0.1875rem solid rgb(var(--v-theme-primary));
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0.01em;
  color: rgba(var(--v-theme-on-surface), 0.95);
}

.settings-vector-recall-block__hint {
  margin: 0.5rem 0 0;
  padding-left: 0.8125rem;
}

.settings-vr-field {
  margin-top: 1rem;
}

.settings-vr-field--muted {
  opacity: 0.72;
}

.settings-vr-field__hint {
  margin: 0.25rem 0 0 2.75rem;
}

.settings-vr-field__control {
  margin-top: 0.625rem;
}

.settings-vr-dict-btn {
  text-transform: none;
  letter-spacing: 0.01em;
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

/* v-radio-group：避免 .v-selection-control-group 的 grid-area 落在 flex 父级上错位 */
.settings-composer-enter-group :deep(.v-input__control) {
  display: grid;
  grid-template-areas: 'input';
  grid-template-columns: minmax(0, 1fr);
}

.settings-composer-enter-group :deep(.v-selection-control-group) {
  grid-area: input;
  display: flex;
  flex-flow: row wrap;
  align-items: center;
  gap: 0.375rem 1.25rem;
}

.settings-composer-enter-group :deep(.v-selection-control) {
  flex: 0 1 auto;
  min-width: 0;
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

.account-stats {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.account-stats__line {
  margin: 0;
}

.account-stats__path {
  margin: 0.25rem 0 0;
  font-family: ui-monospace, monospace;
  word-break: break-all;
  line-height: 1.45;
}

@media (max-width: 40rem) {
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

