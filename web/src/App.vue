<script setup lang="ts">
import ConnectionSettingsCard from '@/components/ConnectionSettingsCard.vue'
import SettingsView from '@/views/SettingsView.vue'
import { htmlLangTag } from '@/i18n/locale'
import { useConnectionStore } from '@/stores/connection'
import { useLocaleStore } from '@/stores/locale'
import { storeToRefs } from 'pinia'
import type { ComponentPublicInstance } from 'vue'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const { locale } = useI18n()
const localeStore = useLocaleStore()
const { effective: effectiveLocale } = storeToRefs(localeStore)
const route = useRoute()

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
const conn = useConnectionStore()

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
      `${Math.round(hh)}px`,
    )
  }
  if (typeof fh === 'number' && fh > 0) {
    document.documentElement.style.setProperty(
      '--footer-height',
      `${Math.round(fh)}px`,
    )
  }
}

onMounted(() => {
  conn.ensureDefaultPresets()
  void conn.loadFromServer().catch(() => {
    conn.ensureDefaultPresets()
  })
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
  <v-app>
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
      :width="380"
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
      color="surface"
      border="b"
      flat
      density="comfortable"
      class="app-bar"
      app
    >
      <template #prepend>
        <v-app-bar-nav-icon @click="drawerLeft = !drawerLeft" />
      </template>

      <div class="app-bar__brand-nav d-flex align-center flex-nowrap min-w-0">
        <v-app-bar-title
          class="app-bar__title text-subtitle-1 font-weight-medium"
        >
          {{ $t('app.title') }}
        </v-app-bar-title>
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
          >
            {{ $t('app.chat') }}
          </v-btn>
          <v-btn variant="text" disabled class="app-bar__menu-btn">
            {{ $t('app.knowledgeBase') }}
          </v-btn>
          <v-btn variant="text" disabled class="app-bar__menu-btn">
            {{ $t('app.characters') }}
          </v-btn>
        </nav>
      </div>

      <v-spacer />

      <div class="app-bar__actions d-flex align-center flex-shrink-0">
        <v-btn
          variant="text"
          prepend-icon="mdi-cog-outline"
          class="d-none d-sm-inline-flex app-bar__menu-btn"
          :active="settingsDialogOpen"
          @click="settingsDialogOpen = true"
        >
          {{ $t('app.settings') }}
        </v-btn>
        <v-btn
          icon="mdi-cog-outline"
          variant="text"
          class="d-sm-none"
          :active="settingsDialogOpen"
          @click="settingsDialogOpen = true"
        />
        <v-btn
          icon="mdi-page-layout-sidebar-right"
          variant="text"
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
      height="36"
      class="pa-0 border-t"
    />

    <v-dialog
      v-model="settingsDialogOpen"
      max-width="640"
      scrollable
      @keydown.esc="settingsDialogOpen = false"
    >
      <v-card rounded="lg">
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
        <v-card-text class="pa-0">
          <SettingsView embedded />
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<style scoped>
.main-chat {
  min-height: 0;
}

/* 顶栏：标题与文本菜单同一行、垂直居中；避免 v-toolbar-title 与 v-btn 基线不齐 */
.app-bar :deep(.v-toolbar__content) {
  align-items: center;
}

.app-bar__brand-nav {
  column-gap: 0.25rem;
  margin-inline-start: 0.25rem;
}

.app-bar__title {
  margin: 0;
  padding: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 auto;
  min-width: 0;
}

.app-bar__title :deep(.v-toolbar-title__placeholder) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-bar__menu {
  column-gap: 0.125rem;
}

.app-bar__menu-btn {
  letter-spacing: normal;
}

.app-bar__actions {
  column-gap: 0.125rem;
}
</style>
