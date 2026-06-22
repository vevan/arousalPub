<script setup lang="ts">
import { CONVERSATION_BRANCH_KEY } from '@/composables/conversation-branch-context'
import type { ChatTurnItem } from '@/types/chat-turn'
import { inject } from 'vue'

const props = defineProps<{
  turn: ChatTurnItem
  disabled?: boolean
}>()

const branchCtx = inject(CONVERSATION_BRANCH_KEY, null)

function onBranchFromHere() {
  if (!branchCtx || props.disabled) return
  void branchCtx.createBranchFromTurn(props.turn)
}

function onOpenBranches() {
  branchCtx?.openBranchPanel()
}
</script>

<template>
  <template v-if="branchCtx">
    <button
      v-if="branchCtx.isForkTurn(turn)"
      type="button"
      class="turn-toolbar__btn turn-toolbar__btn--fork"
      :data-tt="$t('chat.branches.forkPoint')"
      :aria-label="$t('chat.branches.forkPoint')"
      @click="onOpenBranches"
    >
      <v-icon size="16">mdi-source-branch</v-icon>
    </button>
    <button
      type="button"
      class="turn-toolbar__btn"
      :disabled="disabled || branchCtx.branchBusy.value || !turn.turnId"
      :data-tt="
        !turn.turnId
          ? $t('chat.branches.branchFromHereNoTurnId')
          : $t('chat.branches.branchFromHere')
      "
      :aria-label="$t('chat.branches.branchFromHere')"
      @click="onBranchFromHere"
    >
      <v-icon size="16">mdi-source-fork</v-icon>
    </button>
  </template>
</template>

<style scoped>
.turn-toolbar__btn--fork {
  color: rgb(var(--v-theme-primary));
}
</style>
