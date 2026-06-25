<script setup lang="ts">
import type { useChatSession } from '@/composables/useChatSession'
import {
  COMPOSER_INPUT_HISTORY_PINNED_MAX_CAP,
  COMPOSER_INPUT_HISTORY_PINNED_MAX_MIN,
  COMPOSER_INPUT_HISTORY_RECENT_MAX_CAP,
  COMPOSER_INPUT_HISTORY_RECENT_MAX_MIN,
} from '@/utils/composer-input-history-limits'
import { computed, ref, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const { t } = useI18n()
const menuOpen = ref(false)
const settingsOpen = ref(false)
const draftPinnedMax = ref(5)
const draftRecentMax = ref(10)

const { inputHistory, inputHistoryLimits, errorText } = toRefs(props.session)
const {
  pinInputHistoryItem,
  unpinInputHistoryItem,
  fillComposerFromInputHistory,
  applyInputHistoryLimits,
} = props.session

const pinned = computed(() => inputHistory.value.pinned)
const recent = computed(() => inputHistory.value.recent)
const hasItems = computed(
  () => pinned.value.length > 0 || recent.value.length > 0,
)
const showDivider = computed(
  () => pinned.value.length > 0 && recent.value.length > 0,
)

watch(
  inputHistoryLimits,
  (v) => {
    draftPinnedMax.value = v.pinnedMax
    draftRecentMax.value = v.recentMax
  },
  { immediate: true, deep: true },
)

watch(menuOpen, (open) => {
  if (!open) settingsOpen.value = false
})

function onFill(text: string) {
  fillComposerFromInputHistory(text)
  menuOpen.value = false
}

function onPin(text: string) {
  const ok = pinInputHistoryItem(text)
  if (!ok) {
    errorText.value = t('chat.inputHistoryPinnedMax')
  }
}

function onUnpin(text: string) {
  unpinInputHistoryItem(text)
}

function toggleSettings() {
  settingsOpen.value = !settingsOpen.value
  if (settingsOpen.value) {
    draftPinnedMax.value = inputHistoryLimits.value.pinnedMax
    draftRecentMax.value = inputHistoryLimits.value.recentMax
  }
}

function applySettings() {
  applyInputHistoryLimits({
    pinnedMax: draftPinnedMax.value,
    recentMax: draftRecentMax.value,
  })
  settingsOpen.value = false
}
</script>

<template>
  <v-menu
    v-model="menuOpen"
    location="top start"
    :close-on-content-click="false"
    :max-width="320"
  >
    <template #activator="{ props: menuProps }">
      <v-tooltip location="top" :text="t('chat.inputHistoryTooltip')">
        <template #activator="{ props: tooltipProps }">
          <v-btn
            icon
            variant="text"
            size="small"
            density="comfortable"
            class="composer__input-history-btn"
            v-bind="{ ...tooltipProps, ...menuProps }"
            :aria-label="t('chat.inputHistoryTooltip')"
          >
            <v-icon size="20">mdi-history</v-icon>
          </v-btn>
        </template>
      </v-tooltip>
    </template>

    <v-card class="composer-input-history" elevation="8">
      <v-card-title class="composer-input-history__title text-body-2">
        <span class="composer-input-history__title-text">
          {{ t('chat.inputHistoryTitle') }}
        </span>
        <v-btn
          icon
          variant="text"
          size="x-small"
          density="comfortable"
          class="composer-input-history__settings-btn"
          :aria-label="t('chat.inputHistorySettings')"
          :aria-expanded="settingsOpen"
          @click.stop="toggleSettings"
        >
          <v-icon size="18">mdi-cog-outline</v-icon>
        </v-btn>
      </v-card-title>

      <v-expand-transition>
        <div v-if="settingsOpen" class="composer-input-history__settings">
          <v-text-field
            v-model.number="draftPinnedMax"
            type="number"
            density="compact"
            variant="outlined"
            hide-details="auto"
            :label="t('chat.inputHistoryPinnedMaxLabel')"
            :min="COMPOSER_INPUT_HISTORY_PINNED_MAX_MIN"
            :max="COMPOSER_INPUT_HISTORY_PINNED_MAX_CAP"
            class="mb-2"
          />
          <v-text-field
            v-model.number="draftRecentMax"
            type="number"
            density="compact"
            variant="outlined"
            hide-details="auto"
            :label="t('chat.inputHistoryRecentMaxLabel')"
            :min="COMPOSER_INPUT_HISTORY_RECENT_MAX_MIN"
            :max="COMPOSER_INPUT_HISTORY_RECENT_MAX_CAP"
            class="mb-2"
          />
          <v-btn
            size="small"
            color="primary"
            variant="flat"
            block
            @click="applySettings"
          >
            {{ t('chat.inputHistorySettingsApply') }}
          </v-btn>
        </div>
      </v-expand-transition>

      <v-list
        v-if="hasItems"
        density="compact"
        class="composer-input-history__list py-0"
      >
        <v-list-item
          v-for="text in pinned"
          :key="`p-${text}`"
          class="composer-input-history__item"
          @click="onFill(text)"
        >
          <v-tooltip location="top" :text="text">
            <template #activator="{ props: rowTooltipProps }">
              <span
                class="composer-input-history__text"
                v-bind="rowTooltipProps"
              >{{ text }}</span>
            </template>
          </v-tooltip>
          <template #append>
            <v-btn
              icon
              variant="text"
              size="x-small"
              density="comfortable"
              :aria-label="t('chat.inputHistoryUnpin')"
              @click.stop="onUnpin(text)"
            >
              <v-icon size="18">mdi-pin</v-icon>
            </v-btn>
          </template>
        </v-list-item>

        <v-divider v-if="showDivider" class="composer-input-history__divider" />

        <v-list-item
          v-for="text in recent"
          :key="`r-${text}`"
          class="composer-input-history__item"
          @click="onFill(text)"
        >
          <v-tooltip location="top" :text="text">
            <template #activator="{ props: rowTooltipProps }">
              <span
                class="composer-input-history__text"
                v-bind="rowTooltipProps"
              >{{ text }}</span>
            </template>
          </v-tooltip>
          <template #append>
            <v-btn
              icon
              variant="text"
              size="x-small"
              density="comfortable"
              :aria-label="t('chat.inputHistoryPin')"
              @click.stop="onPin(text)"
            >
              <v-icon size="18">mdi-pin-outline</v-icon>
            </v-btn>
          </template>
        </v-list-item>
      </v-list>
      <div
        v-else
        class="composer-input-history__empty text-medium-emphasis text-body-2"
      >
        {{ t('chat.inputHistoryEmpty') }}
      </div>
    </v-card>
  </v-menu>
</template>
