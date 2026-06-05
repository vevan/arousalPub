<script setup lang="ts">
import ConnectionSettingsCard from '@/components/ConnectionSettingsCard.vue'
import CharactersView from '@/views/CharactersView.vue'
import LorebooksView from '@/views/LorebooksView.vue'
import PromptsView from '@/views/PromptsView.vue'
import SettingsView from '@/views/SettingsView.vue'
import AuthView from '@/views/AuthView.vue'
import { htmlLangTag } from '@/i18n/locale'
import { bootstrapAppData, resetBootstrapAppData } from '@/bootstrap/app-data'
import { useAuthStore } from '@/stores/auth'
import { userAvatarUrl } from '@/utils/authenticated-media-url'
import { useConnectionStore } from '@/stores/connection'
import { useLocaleStore } from '@/stores/locale'
import { useLorebooksStore } from '@/stores/lorebooks'
import { usePromptsStore } from '@/stores/prompts'
import { useUiContextStore } from '@/stores/ui-context'
import { storeToRefs } from 'pinia'
import type { ComponentPublicInstance } from 'vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

const { locale } = useI18n()
const localeStore = useLocaleStore()
const { effective: effectiveLocale } = storeToRefs(localeStore)
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const userBarAvatarSrc = computed(() =>
  auth.user ? userAvatarUrl(auth.user.id) : null,
)

const authPhase = ref<'loading' | 'setup' | 'login' | 'app'>('loading')
const settingsInitialTab = ref<'system' | 'display' | 'account' | 'lorebook' | 'history' | 'budgetTrim' | 'plugins' | 'debug'>('system')

async function enterApp() {
  resetBootstrapAppData()
  const boot = bootstrapAppData()
  authPhase.value = 'app'
  auth.startSessionRefreshLoop()
  await boot
}

async function initAuth() {
  authPhase.value = 'loading'
  const phase = await auth.initSession()
  if (phase === 'setup') {
    authPhase.value = 'setup'
    return
  }
  if (phase === 'login') {
    authPhase.value = 'login'
    return
  }
  await enterApp()
}

function openAccountSettings() {
  settingsInitialTab.value = 'account'
  settingsDialogOpen.value = true
}

watch(
  effectiveLocale,
  (l) => {
    locale.value = l
    if (typeof document !== 'undefined') {
      document.documentElement.lang = htmlLangTag(l)
    }
  },
  { immediate: true },
)

function onBrowserLanguageChange() {
  if (localeStore.preference !== 'auto') return
  locale.value = localeStore.effective
  if (typeof document !== 'undefined') {
    document.documentElement.lang = htmlLangTag(localeStore.effective)
  }
}

const drawerLeft = ref(false)
const drawerRight = ref(false)
const settingsDialogOpen = ref(false)
const settingsDialogOpenCount = ref(0)

watch(settingsDialogOpen, (open) => {
  if (open) settingsDialogOpenCount.value += 1
})
const promptsDialogOpen = ref(false)
const charactersDialogOpen = ref(false)
const lorebooksDialogOpen = ref(false)
const mobileNavOpen = ref(false)
const conn = useConnectionStore()
const lorebooksStore = useLorebooksStore()
const promptsStore = usePromptsStore()
const uiContext = useUiContextStore()

const appBarApiLabel = computed(() => {
  const alias = conn.alias.trim()
  const model = conn.model.trim()
  if (alias && model) return `${alias} · ${model}`
  if (alias) return alias
  return model
})

const appBarApiStatusTitle = computed(() => {
  const alias = conn.alias.trim()
  const model = conn.model.trim()
  const parts: string[] = []
  if (alias) parts.push(`${alias}`)
  if (model) parts.push(model)
  return parts.join(' · ')
})

function clearPanelQuery() {
  if (route.query.panel === undefined) return
  const { panel: _p, ...rest } = route.query
  void router.replace({
    path: route.path,
    query: Object.keys(rest).length > 0 ? rest : {},
  })
}

function openPromptsDialog() {
  charactersDialogOpen.value = false
  lorebooksDialogOpen.value = false
  promptsDialogOpen.value = true
}

function openCharactersDialog() {
  promptsDialogOpen.value = false
  lorebooksDialogOpen.value = false
  charactersDialogOpen.value = true
}

function openLorebooksDialog() {
  promptsDialogOpen.value = false
  charactersDialogOpen.value = false
  lorebooksDialogOpen.value = true
}

function closeMobileNav() {
  mobileNavOpen.value = false
}

function mobileNavToChat() {
  closeMobileNav()
  void router.push('/')
}

function mobileNavOpenPrompts() {
  closeMobileNav()
  openPromptsDialog()
}

function mobileNavOpenCharacters() {
  closeMobileNav()
  openCharactersDialog()
}

function mobileNavOpenLorebooks() {
  closeMobileNav()
  openLorebooksDialog()
}

async function focusLorebooksForOpen(): Promise<void> {
  const preferred = uiContext.consumePendingLorebookFocusId()
  await lorebooksStore.applyOpenFocus(
    uiContext.conversationLorebookIds,
    preferred,
  )
}

async function focusPromptsForOpen(): Promise<void> {
  const preferred = uiContext.consumePendingPromptFocusPresetId()
  await promptsStore.applyOpenFocus(
    uiContext.conversationPromptPresetId,
    preferred,
  )
}

watch(lorebooksDialogOpen, (open) => {
  if (open) void focusLorebooksForOpen()
})

watch(promptsDialogOpen, (open) => {
  if (open) void focusPromptsForOpen()
})

watch(
  () => uiContext.openLorebooksSignal,
  () => {
    const wasOpen = lorebooksDialogOpen.value
    openLorebooksDialog()
    if (wasOpen) void focusLorebooksForOpen()
  },
)

watch(
  () => uiContext.openPromptsSignal,
  () => {
    const wasOpen = promptsDialogOpen.value
    openPromptsDialog()
    if (wasOpen) void focusPromptsForOpen()
  },
)

watch(
  () => route.query.panel,
  (panelRaw) => {
    const panel = Array.isArray(panelRaw) ? panelRaw[0] : panelRaw
    if (panel === 'prompts') {
      promptsDialogOpen.value = true
      charactersDialogOpen.value = false
      lorebooksDialogOpen.value = false
      void nextTick(() => clearPanelQuery())
    } else if (panel === 'characters') {
      charactersDialogOpen.value = true
      promptsDialogOpen.value = false
      lorebooksDialogOpen.value = false
      void nextTick(() => clearPanelQuery())
    } else if (panel === 'lorebooks') {
      lorebooksDialogOpen.value = true
      promptsDialogOpen.value = false
      charactersDialogOpen.value = false
      void nextTick(() => clearPanelQuery())
    }
  },
  { immediate: true },
)

const appBarRef = ref<ComponentPublicInstance | null>(null)
const footerRef = ref<ComponentPublicInstance | null>(null)
let layoutResizeObserver: ResizeObserver | null = null

function syncAppChromeCssVars() {
  if (typeof document === 'undefined') return
  const barEl = appBarRef.value?.$el as HTMLElement | undefined
  const footEl = footerRef.value?.$el as HTMLElement | undefined
  const hh = barEl?.getBoundingClientRect().height
  const fh = footEl?.getBoundingClientRect().height
  if (typeof hh === 'number' && hh > 0) {
    document.documentElement.style.setProperty(
      '--header-height',
      `${Math.round(hh) / 16}rem`,
    )
  }
  if (typeof fh === 'number' && fh > 0) {
    document.documentElement.style.setProperty(
      '--footer-height',
      `${Math.round(fh) / 16}rem`,
    )
  }
}

onMounted(() => {
  void initAuth()
  if (typeof window !== 'undefined') {
    window.addEventListener('languagechange', onBrowserLanguageChange)
  }
  void nextTick(() => {
    syncAppChromeCssVars()
    if (typeof ResizeObserver === 'undefined') return
    const barEl = appBarRef.value?.$el as HTMLElement | undefined
    const footEl = footerRef.value?.$el as HTMLElement | undefined
    layoutResizeObserver = new ResizeObserver(() => syncAppChromeCssVars())
    if (barEl) layoutResizeObserver.observe(barEl)
    if (footEl) layoutResizeObserver.observe(footEl)
  })
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', syncAppChromeCssVars)
  }
})

onUnmounted(() => {
  layoutResizeObserver?.disconnect()
  layoutResizeObserver = null
  if (typeof window === 'undefined') return
  window.removeEventListener('resize', syncAppChromeCssVars)
  window.removeEventListener('languagechange', onBrowserLanguageChange)
})
</script>

<template>
  <v-app v-if="authPhase === 'loading'" class="auth-loading">
    <div class="d-flex fill-height align-center justify-center">
      <v-progress-circular indeterminate color="primary" />
    </div>
  </v-app>

  <v-app v-else-if="authPhase === 'setup'" class="auth-app">
    <v-main class="auth-app__main d-flex align-center justify-center">
      <AuthView mode="setup" @done="enterApp" />
    </v-main>
  </v-app>
  <v-app v-else-if="authPhase === 'login'" class="auth-app">
    <v-main class="auth-app__main d-flex align-center justify-center">
      <AuthView mode="login" @done="enterApp" />
    </v-main>
  </v-app>

  <v-app v-else>
    <!-- VNavigationDrawer :width 须为无单位数字（px）；rem/% 等字符串会破坏布局与开关（Vuetify #16705） -->
    <v-navigation-drawer
      v-model="drawerLeft"
      :width="280"
      temporary
      location="start"
      border="end"
    >
      <v-toolbar density="compact" color="surface-variant" flat>
        <v-toolbar-title class="text-subtitle-2">
          {{ $t('app.plugins') }}
        </v-toolbar-title>
      </v-toolbar>
      <div class="pa-4 text-body-2 text-medium-emphasis">
        {{ $t('app.pluginsHint') }}
      </div>
    </v-navigation-drawer>

    <v-navigation-drawer
      v-model="drawerRight"
      :width="440"
      temporary
      location="end"
      border="start"
    >
      <v-toolbar density="compact" color="surface-variant" flat>
        <v-toolbar-title class="text-subtitle-2">
          {{ $t('app.apiConnection') }}
        </v-toolbar-title>
      </v-toolbar>
      <ConnectionSettingsCard />
    </v-navigation-drawer>

    <v-app-bar
      ref="appBarRef"
      color="transparent"
      flat
      density="comfortable"
      class="app-bar"
      app
    >
      <div class="app-bar__brand-nav d-flex align-center flex-nowrap min-w-0">
        <div class="app-bar__mobile-nav-wrap d-flex d-sm-none flex-shrink-0">
          <v-menu
            v-model="mobileNavOpen"
            location="bottom start"
            :offset="8"
          >
            <template #activator="{ props: menuProps }">
              <button
                type="button"
                class="app-bar__brand app-bar__brand--activator d-flex align-center flex-shrink-0"
                v-bind="menuProps"
                :aria-expanded="mobileNavOpen"
                :aria-label="$t('app.mainNav')"
              >
              <svg
                class="app-bar__brand-flame"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M12 3 C 13 6 16 8 16 12 C 16 15.5 14.2 18 12 18 C 9.8 18 8 15.5 8 12 C 8 9 10 7 12 3 Z"
                  fill="rgba(var(--v-theme-primary), 0.18)"
                  stroke="rgb(var(--v-theme-primary))"
                  stroke-width="1.4"
                  stroke-linejoin="round"
                />
                <path
                  d="M11.6 9.5 C 11.8 10.8 12.8 11.5 12.6 13 C 12.4 14.2 11.6 14.6 11 14.5"
                  stroke="rgb(var(--v-theme-secondary))"
                  stroke-width="1.2"
                  stroke-linecap="round"
                />
                <path
                  d="M12 18 L 12 20"
                  stroke="rgb(var(--v-theme-secondary))"
                  stroke-width="1.4"
                  stroke-linecap="round"
                />
                <ellipse
                  cx="12"
                  cy="20.5"
                  rx="3"
                  ry="0.5"
                  fill="rgba(var(--v-theme-secondary), 0.45)"
                />
              </svg>
              <span class="app-bar__brand-name">
                Arousal <em>Pub</em>
              </span>
              <v-icon
                icon="mdi-chevron-down"
                size="18"
                class="app-bar__brand-caret"
                :class="{ 'app-bar__brand-caret--open': mobileNavOpen }"
              />
            </button>
          </template>
          <v-list
            density="compact"
            nav
            class="app-bar__mobile-nav py-1"
          >
            <v-list-item
              :title="$t('app.chat')"
              :active="route.name === 'home' || route.name === 'chat'"
              rounded="lg"
              @click="mobileNavToChat"
            />
            <v-list-item
              :title="$t('app.prompts')"
              :active="promptsDialogOpen"
              rounded="lg"
              @click="mobileNavOpenPrompts"
            />
            <v-list-item
              :title="$t('app.characters')"
              :active="charactersDialogOpen"
              rounded="lg"
              @click="mobileNavOpenCharacters"
            />
            <v-list-item
              :title="$t('app.lorebooks')"
              :active="lorebooksDialogOpen"
              rounded="lg"
              @click="mobileNavOpenLorebooks"
            />
          </v-list>
          </v-menu>
        </div>

        <div class="app-bar__brand d-none d-sm-flex align-center flex-shrink-0">
          <!-- 自绘火焰 logo · 不用 MDI 通用 icon -->
          <svg
            class="app-bar__brand-flame"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 3 C 13 6 16 8 16 12 C 16 15.5 14.2 18 12 18 C 9.8 18 8 15.5 8 12 C 8 9 10 7 12 3 Z"
              fill="rgba(var(--v-theme-primary), 0.18)"
              stroke="rgb(var(--v-theme-primary))"
              stroke-width="1.4"
              stroke-linejoin="round"
            />
            <path
              d="M11.6 9.5 C 11.8 10.8 12.8 11.5 12.6 13 C 12.4 14.2 11.6 14.6 11 14.5"
              stroke="rgb(var(--v-theme-secondary))"
              stroke-width="1.2"
              stroke-linecap="round"
            />
            <path
              d="M12 18 L 12 20"
              stroke="rgb(var(--v-theme-secondary))"
              stroke-width="1.4"
              stroke-linecap="round"
            />
            <ellipse
              cx="12"
              cy="20.5"
              rx="3"
              ry="0.5"
              fill="rgba(var(--v-theme-secondary), 0.45)"
            />
          </svg>
          <span class="app-bar__brand-name">
            Arousal <em>Pub</em>
          </span>
        </div>

        <nav
          class="app-bar__menu d-none d-sm-flex align-center flex-shrink-0"
          :aria-label="$t('app.mainNav')"
        >
          <v-btn
            to="/"
            variant="text"
            exact
            :active="route.name === 'home' || route.name === 'chat'"
            class="app-bar__menu-btn"
            size="small"
          >
            {{ $t('app.chat') }}
          </v-btn>
          <v-btn
            variant="text"
            :active="promptsDialogOpen"
            class="app-bar__menu-btn"
            size="small"
            @click="openPromptsDialog"
          >
            {{ $t('app.prompts') }}
          </v-btn>
          <v-btn
            variant="text"
            :active="charactersDialogOpen"
            class="app-bar__menu-btn"
            size="small"
            @click="openCharactersDialog"
          >
            {{ $t('app.characters') }}
          </v-btn>
          <v-btn
            variant="text"
            :active="lorebooksDialogOpen"
            class="app-bar__menu-btn"
            size="small"
            @click="openLorebooksDialog"
          >
            {{ $t('app.lorebooks') }}
          </v-btn>
        </nav>
      </div>

      <v-spacer />

      <div class="app-bar__actions d-flex align-center flex-shrink-0">
        <!-- 当前 model 状态 chip -->
        <button
          v-if="appBarApiLabel"
          type="button"
          class="app-bar__status-chip d-none d-md-inline-flex"
          :title="appBarApiStatusTitle"
          @click="drawerRight = !drawerRight"
        >
          <span class="app-bar__status-dot" />
          <span class="app-bar__status-model text-truncate">
            {{ appBarApiLabel }}
          </span>
        </button>

        <v-btn
          v-if="auth.user"
          variant="text"
          size="small"
          class="app-bar__user-btn text-none"
          @click="openAccountSettings"
        >
          <v-avatar size="28" rounded="circle" class="me-2">
            <v-img :src="userBarAvatarSrc ?? undefined" cover />
          </v-avatar>
          <span class="d-none d-sm-inline">{{ auth.user.displayName || auth.user.username }}</span>
        </v-btn>

        <v-btn
          icon="mdi-cog-outline"
          variant="text"
          size="small"
          density="comfortable"
          :active="settingsDialogOpen"
          class="app-bar__icon-btn"
          :aria-label="$t('app.settings')"
          @click="
            () => {
              settingsInitialTab = 'system'
              settingsDialogOpen = true
            }
          "
        />
        <v-btn
          icon="mdi-link-variant"
          variant="text"
          size="small"
          density="comfortable"
          class="app-bar__icon-btn"
          :aria-label="$t('app.apiConnection')"
          @click="drawerRight = !drawerRight"
        />
      </div>
    </v-app-bar>

    <v-main class="main-chat d-flex flex-column">
      <!-- 不在此挂 d-flex：会合并到子路由根节点并覆盖 ChatConversationView 的 display:grid -->
      <router-view />
    </v-main>

    <v-footer
      ref="footerRef"
      app
      :height="28"
      class="app-footer pa-0"
    >
      <div class="app-footer__inner">
        <v-btn
          icon="mdi-menu"
          variant="text"
          size="x-small"
          density="compact"
          class="app-footer__plugins-btn"
          :aria-label="$t('app.plugins')"
          @click="drawerLeft = !drawerLeft"
        />
        <span class="app-footer__meta">
          Arousal <em>Pub</em>
        </span>
      </div>
    </v-footer>

    <v-dialog
      v-model="settingsDialogOpen"
      scrollable
      content-class="app-config-dialog-surface"
      @keydown.esc="settingsDialogOpen = false"
    >
      <v-card rounded="lg" class="settings-dialog-card">
        <v-card-title class="d-flex align-center py-3 flex-wrap">
          <span class="text-h6 font-weight-medium">{{ $t('settings.pageTitle') }}</span>
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            density="comfortable"
            :aria-label="$t('settings.closeModal')"
            @click="settingsDialogOpen = false"
          />
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-3 pa-sm-4 settings-dialog-body">
          <SettingsView
            embedded
            :initial-tab="settingsInitialTab"
            :open-count="settingsDialogOpenCount"
            @logout="
              () => {
                auth.logout()
                resetBootstrapAppData()
                settingsDialogOpen = false
                authPhase = 'login'
              }
            "
          />
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="promptsDialogOpen"
      scrollable
      content-class="library-dialog-surface"
      @keydown.esc="promptsDialogOpen = false"
    >
      <v-card rounded="lg" class="library-dialog-card">
        <v-toolbar density="compact" color="transparent" flat class="library-dialog-toolbar">
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            density="comfortable"
            :aria-label="$t('settings.closeModal')"
            @click="promptsDialogOpen = false"
          />
        </v-toolbar>
        <v-divider />
        <v-card-text class="pa-0 library-dialog-body">
          <PromptsView v-if="promptsDialogOpen" embedded />
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="charactersDialogOpen"
      scrollable
      content-class="library-dialog-surface"
      @keydown.esc="charactersDialogOpen = false"
    >
      <v-card rounded="lg" class="library-dialog-card">
        <v-toolbar density="compact" color="transparent" flat class="library-dialog-toolbar">
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            density="comfortable"
            :aria-label="$t('settings.closeModal')"
            @click="charactersDialogOpen = false"
          />
        </v-toolbar>
        <v-divider />
        <v-card-text class="pa-0 library-dialog-body">
          <CharactersView embedded />
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="lorebooksDialogOpen"
      scrollable
      content-class="library-dialog-surface"
      @keydown.esc="lorebooksDialogOpen = false"
    >
      <v-card rounded="lg" class="library-dialog-card">
        <v-toolbar density="compact" color="transparent" flat class="library-dialog-toolbar">
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            density="comfortable"
            :aria-label="$t('settings.closeModal')"
            @click="lorebooksDialogOpen = false"
          />
        </v-toolbar>
        <v-divider />
        <v-card-text class="pa-0 library-dialog-body">
          <LorebooksView embedded />
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<style scoped>
.library-dialog-card,
.settings-dialog-card {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  max-height: 100%;
}

.settings-dialog-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.library-dialog-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.library-dialog-toolbar {
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.08);
}

.main-chat {
  min-height: 0;
}

.auth-app__main {
  min-height: 100dvh;
}

/* ========== AppBar · Tavern × Linear ==========
 * demo: linear-gradient(180deg, rgba(36, 31, 24, 0.4), transparent)
 * 36/31/24 即 --v-theme-surface-bright (elev-3)
 */
.app-bar {
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10) !important;
  background: linear-gradient(
    180deg,
    rgba(var(--v-theme-surface-bright), 0.4),
    transparent
  ) !important;
  backdrop-filter: blur(0.5rem);
}
.app-bar :deep(.v-toolbar__content) {
  align-items: center;
  padding-inline: 0.75rem;
  background: transparent;
}

.app-bar__brand-nav {
  column-gap: 0.75rem;
}
@media (min-width: 600px) {
  .app-bar__mobile-nav-wrap {
    display: none !important;
  }
}

.app-bar__brand {
  gap: 0.5rem;
  padding-right: 0.75rem;
  border-right: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.06);
}
.app-bar__brand--activator {
  cursor: pointer;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  padding: 0;
  margin: 0;
  appearance: none;
  border-right: none;
  padding-right: 0;
}
.app-bar__brand-caret {
  color: rgba(var(--v-theme-on-surface), 0.5);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
.app-bar__brand-caret--open {
  transform: rotate(180deg);
}
.app-bar__mobile-nav {
  min-width: 10.5rem;
}
.app-bar__mobile-nav :deep(.v-list-item--active) {
  color: rgb(var(--v-theme-on-surface));
}
.app-bar__mobile-nav :deep(.v-list-item--active .v-list-item__overlay) {
  background: rgba(var(--v-theme-primary), 0.08);
  opacity: 1;
}
.app-bar__brand-flame {
  width: 1.375rem;
  height: 1.375rem;
  flex-shrink: 0;
}
.app-bar__brand-name {
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: rgb(var(--v-theme-on-surface));
  line-height: 1;
  white-space: nowrap;
}
.app-bar__brand-name em {
  font-style: italic;
  color: rgb(var(--v-theme-primary));
  font-weight: 500;
}

/* nav 按钮 · demo: hover 4% ink 底；active = 8% accent 底 + inset bottom 0.125rem accent + 顶圆下方 */
.app-bar__menu {
  column-gap: 0.25rem;
}
.app-bar__menu-btn {
  letter-spacing: 0.005em;
  font-weight: 500;
  text-transform: none;
  border-radius: var(--radius-sm) !important;
  color: rgba(var(--v-theme-on-surface), 0.78);
}
.app-bar__menu-btn :deep(.v-btn__content) {
  font-family: var(--font-ui);
  font-size: 0.8125rem;
}
.app-bar__menu-btn:not(.v-btn--active):hover :deep(.v-btn__overlay) {
  background: rgba(var(--v-theme-on-surface), 0.04);
  opacity: 1;
}
.app-bar__menu-btn.v-btn--active {
  color: rgb(var(--v-theme-on-surface));
  /* demo: inset 0 -0.125rem 0 var(--accent) — 底部 0.125rem 实线条作为视觉下划 */
  box-shadow: inset 0 -0.125rem 0 rgb(var(--v-theme-primary)) !important;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0 !important;
}
.app-bar__menu-btn.v-btn--active :deep(.v-btn__overlay) {
  background: rgba(var(--v-theme-primary), 0.08);
  opacity: 1;
}

/* 右侧 actions */
.app-bar__actions {
  column-gap: 0.25rem;
}

.app-bar__status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3125rem 0.625rem;
  height: 1.875rem;
  margin-right: 0.25rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: var(--radius-sm);
  background: rgb(var(--v-theme-surface-light));
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-family: var(--font-mono);
  font-size: 0.7188rem;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.15s ease;
  max-width: 18rem;
}
.app-bar__status-chip:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
  color: rgb(var(--v-theme-on-surface));
}
.app-bar__status-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: rgb(var(--v-theme-success, 122 143 106));
  box-shadow: 0 0 0 0.1875rem rgb(var(--v-theme-success, 122 143 106) / 0.18);
  flex-shrink: 0;
}
.app-bar__status-model {
  max-width: 11.25rem;
}
.app-bar__icon-btn {
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.app-bar__icon-btn:hover {
  color: rgb(var(--v-theme-on-surface));
}

/* ========== Footer ========== */
.app-footer {
  border-top: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.06) !important;
  background: transparent !important;
}
.app-footer__inner {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0 0.5rem 0 0.25rem;
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.app-footer__plugins-btn {
  flex-shrink: 0;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.app-footer__plugins-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.app-footer__meta {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-style: italic;
  letter-spacing: 0.02em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.app-footer__meta em {
  color: rgba(var(--v-theme-primary), 0.7);
}
</style>
