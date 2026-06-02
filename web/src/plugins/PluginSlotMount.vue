<script setup lang="ts">

import { PLUGIN_HOST_KEY } from '@/plugins/injection'

import type { PluginSlotButtonDef, PluginSlotContext } from '@/plugins/types'

import type { ChatTurnItem } from '@/types/chat-turn'

import { computed, inject } from 'vue'

import { useI18n } from 'vue-i18n'



const props = defineProps<{

  slotName: string

  turn?: ChatTurnItem

  listIndex?: number

}>()



const pluginHost = inject(PLUGIN_HOST_KEY)

const { t } = useI18n()



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



function resolveIcon(btn: PluginSlotButtonDef): string {

  return typeof btn.icon === 'function' ? btn.icon(slotCtx()) : btn.icon

}



function resolveTooltipKey(btn: PluginSlotButtonDef): string {

  return typeof btn.tooltipKey === 'function'

    ? btn.tooltipKey(slotCtx())

    : btn.tooltipKey

}



function isFilled(btn: PluginSlotButtonDef): boolean {

  if (btn.filled == null) return false

  return typeof btn.filled === 'function' ? btn.filled(slotCtx()) : btn.filled

}



function isDisabled(btn: PluginSlotButtonDef): boolean {

  if (!btn.disabled) return false

  return btn.disabled(slotCtx())

}

</script>



<template>

  <template v-for="btn in buttons" :key="btn.id">

    <button

      type="button"

      class="plugin-slot"

      :class="{ 'is-filled': isFilled(btn) }"

      :disabled="isDisabled(btn)"

      :data-tt="t(resolveTooltipKey(btn))"

      :aria-label="t(resolveTooltipKey(btn))"

      @click="btn.onClick({ turn, listIndex })"

    >

      <v-icon size="13">{{ resolveIcon(btn) }}</v-icon>

    </button>

  </template>

</template>

