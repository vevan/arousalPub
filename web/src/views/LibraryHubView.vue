<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import FilesView from '@/views/FilesView.vue'
import KnowledgeBasesView from '@/views/KnowledgeBasesView.vue'

type LibraryHubTab = 'assets' | 'knowledge'

const props = withDefaults(
  defineProps<{
    embedded?: boolean
    tab?: LibraryHubTab
  }>(),
  { embedded: false, tab: 'assets' },
)

const emit = defineEmits<{
  close: []
  'update:tab': [tab: LibraryHubTab]
}>()

const activeTab = ref<LibraryHubTab>(props.tab)

/** 懒挂载：只有访问过的 tab 才挂载子视图，避免打开即双份列表请求 */
const visited = reactive<Record<LibraryHubTab, boolean>>({
  assets: false,
  knowledge: false,
})

watch(
  () => props.tab,
  (v) => {
    if (v && v !== activeTab.value) activeTab.value = v
  },
)

watch(
  activeTab,
  (v) => {
    visited[v] = true
  },
  { immediate: true },
)

watch(activeTab, (v) => {
  emit('update:tab', v)
})
</script>

<template>
  <div
    class="libhub flex-grow-1 d-flex flex-column min-height-0"
    :class="{ 'libhub--embedded': props.embedded }"
  >
    <div
      class="libhub__head"
      :class="props.embedded ? 'libhub__head--embedded' : 'app-page-shell libhub__head--page'"
    >
      <header
        class="library-page-head"
        :class="{ 'library-page-head--with-close': props.embedded }"
      >
        <div class="library-page-head__row">
          <v-tabs
            v-model="activeTab"
            density="compact"
            class="libhub-tabs"
            :aria-label="$t('library.tabsAria')"
          >
            <v-tab value="assets" class="libhub-tab">
              {{ $t('files.pageTitle') }}
            </v-tab>
            <v-tab value="knowledge" class="libhub-tab">
              {{ $t('knowledgeBases.pageTitle') }}
            </v-tab>
          </v-tabs>
          <div class="library-page-head__aside">
            <p class="library-page-head__lede">
              {{ activeTab === 'assets' ? $t('files.lede') : $t('knowledgeBases.lede') }}
            </p>
          </div>
          <button
            v-if="props.embedded"
            type="button"
            class="library-page-head__close"
            :aria-label="$t('app.closeModal')"
            @click="emit('close')"
          >
            <v-icon size="20">mdi-close</v-icon>
          </button>
        </div>
      </header>
    </div>

    <!-- 子视图根元素带 d-flex(!important)，v-show 需作用在外层容器上 -->
    <div v-if="visited.assets" v-show="activeTab === 'assets'" class="libhub__pane">
      <FilesView
        :embedded="props.embedded"
        chromeless
        @close="emit('close')"
      />
    </div>
    <div v-if="visited.knowledge" v-show="activeTab === 'knowledge'" class="libhub__pane">
      <KnowledgeBasesView
        :embedded="props.embedded"
        chromeless
        @close="emit('close')"
      />
    </div>
  </div>
</template>

<style scoped>
.libhub--embedded {
  height: 100%;
  min-height: 0;
}
.libhub__pane {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.libhub__head {
  flex-shrink: 0;
  padding: 1rem 1.25rem 0;
}
.libhub__head--embedded {
  padding-top: 0.75rem;
}
/* 非嵌入模式沿用 app-page-shell 的水平布局，仅保留自身上边距 */
.libhub__head--page {
  padding-bottom: 0;
}
.libhub-tabs {
  --v-tabs-height: 2.25rem;
}
.libhub-tab {
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-style: italic;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
}
</style>
