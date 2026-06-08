<script setup lang="ts">
import { PLUGIN_HOST_KEY } from '@/plugins/injection'
import type {
  PluginSlotButtonDef,
  PluginSlotContext,
  PluginSlotMenuItemDef,
} from '@/plugins/types'
import type { ChatTurnItem } from '@/types/chat-turn'
import { computed, inject, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  slotName: string
  turn?: ChatTurnItem
  listIndex?: number
}>()

const pluginHost = inject(PLUGIN_HOST_KEY)
const { t } = useI18n()

onMounted(() => {
  void pluginHost?.ensureSlotPlugins(props.slotName)
})

watch(
  () => props.slotName,
  (slotName) => {
    void pluginHost?.ensureSlotPlugins(slotName)
  },
)

const buttons = computed(() =>
  pluginHost?.getSlotButtons(props.slotName, {
    turn: props.turn,
    listIndex: props.listIndex,
  }) ?? [],
)

function slotCtx(): PluginSlotContext {
  return {
    turn: props.turn,
    listIndex: props.listIndex,
  }
}

function resolveIcon(icon: string | ((ctx: PluginSlotContext) => string)): string {
  return typeof icon === 'function' ? icon(slotCtx()) : icon
}

function resolveExtraClass(
  value: string | ((ctx: PluginSlotContext) => string) | undefined,
): string {
  if (!value) return ''
  return typeof value === 'function' ? value(slotCtx()) : value
}

function resolveIconSize(btn: PluginSlotButtonDef): number {
  const raw = btn.iconSize
  if (raw == null) {
    return props.slotName === 'turn-block-head' ? 20 : 13
  }
  return typeof raw === 'function' ? raw(slotCtx()) : raw
}

function resolveTooltipKey(btn: PluginSlotButtonDef): string {
  return typeof btn.tooltipKey === 'function'
    ? btn.tooltipKey(slotCtx())
    : btn.tooltipKey
}

function resolveLabelKey(item: PluginSlotMenuItemDef): string {
  return typeof item.labelKey === 'function'
    ? item.labelKey(slotCtx())
    : item.labelKey
}

function isFilled(
  value: boolean | ((ctx: PluginSlotContext) => boolean) | undefined,
): boolean {
  if (value == null) return false
  return typeof value === 'function' ? value(slotCtx()) : value
}

function isDisabled(
  fn: ((ctx: PluginSlotContext) => boolean) | undefined,
): boolean {
  if (!fn) return false
  return fn(slotCtx())
}

function menuOpenOnHover(btn: PluginSlotButtonDef): boolean {
  const mode = btn.menuOpenOn ?? 'both'
  return mode === 'hover' || mode === 'both'
}

function menuOpenOnClick(btn: PluginSlotButtonDef): boolean {
  const mode = btn.menuOpenOn ?? 'both'
  return mode === 'click' || mode === 'both'
}

function onMenuItemClick(item: PluginSlotMenuItemDef) {
  if (isDisabled(item.disabled)) return
  item.onClick(slotCtx())
}

function onPlainClick(btn: PluginSlotButtonDef) {
  btn.onClick?.(slotCtx())
}
</script>

<template>
  <template
    v-for="btn in buttons"
    :key="btn.id"
  >
    <v-menu
      v-if="btn.menu?.length"
      :open-on-hover="menuOpenOnHover(btn)"
      :open-on-click="menuOpenOnClick(btn)"
      :close-on-content-click="true"
      location="top"
      :open-delay="200"
      :close-delay="120"
      offset="6"
    >
      <template #activator="{ props: menuProps }">
        <button
          type="button"
          class="plugin-slot"
          :class="[resolveExtraClass(btn.class), { 'is-filled': isFilled(btn.filled) }]"
          :disabled="isDisabled(btn.disabled)"
          v-bind="menuProps"
          :data-tt="t(resolveTooltipKey(btn))"
          :aria-label="t(resolveTooltipKey(btn))"
        >
          <v-icon :size="resolveIconSize(btn)">{{ resolveIcon(btn.icon) }}</v-icon>
        </button>
      </template>
      <v-list
        class="plugin-slot-menu"
        density="compact"
        nav
      >
        <v-list-item
          v-for="item in btn.menu"
          :key="item.id"
          :disabled="isDisabled(item.disabled)"
          :class="{ 'plugin-slot-menu__item--filled': isFilled(item.filled) }"
          @click="onMenuItemClick(item)"
        >
          <template
            v-if="item.icon"
            #prepend
          >
            <v-icon
              size="16"
              class="plugin-slot-menu__icon"
            >
              {{ resolveIcon(item.icon) }}
            </v-icon>
          </template>
          <v-list-item-title class="text-body-2">
            {{ t(resolveLabelKey(item)) }}
          </v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>

    <button
      v-else
      type="button"
      class="plugin-slot"
      :class="[resolveExtraClass(btn.class), { 'is-filled': isFilled(btn.filled) }]"
      :disabled="isDisabled(btn.disabled)"
      :data-tt="t(resolveTooltipKey(btn))"
      :aria-label="t(resolveTooltipKey(btn))"
      @click="onPlainClick(btn)"
    >
      <v-icon :size="resolveIconSize(btn)">{{ resolveIcon(btn.icon) }}</v-icon>
    </button>
  </template>
</template>
