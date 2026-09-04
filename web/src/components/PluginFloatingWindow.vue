<script setup lang="ts">
import {
  bringFloatingPanelToFront,
  dispatchPluginPanelDomEvent,
  movePluginPanel,
  notifyPluginPanelMounted,
  setFloatingPanelHidden,
  setFloatingPanelPosition,
  setFloatingPanelSize,
  type PluginPanelEntry,
  type PluginPanelLayout,
} from '@/plugins/plugin-panel-registry'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const props = defineProps<{
  panel: PluginPanelEntry & { layout: PluginPanelLayout }
}>()

const { t, te } = useI18n()
const route = useRoute()
const contentRef = ref<HTMLElement | null>(null)
const dragPosition = ref<{ x: number; y: number } | null>(null)
const resizeSize = ref<{ width: number; height: number } | null>(null)
const viewportRevision = ref(0)
let dragStart: { pointerId: number; x: number; y: number; left: number; top: number } | null = null
let resizeStart: { pointerId: number; x: number; y: number; width: number; height: number } | null = null

const DEFAULT_WIDTH = 360
const DEFAULT_HEIGHT = 440
const MIN_WIDTH = 280
const MIN_HEIGHT = 220

const title = computed(() => translatePluginI18nKey(props.panel.tabLabelKey, t, te))
const position = computed(() => dragPosition.value ?? props.panel.layout.floating ?? { x: 72, y: 96, z: 100 })
const size = computed(() => resizeSize.value ?? {
  width: props.panel.layout.floating?.width ?? DEFAULT_WIDTH,
  height: props.panel.layout.floating?.height ?? DEFAULT_HEIGHT,
})
const displaySize = computed(() => {
  void viewportRevision.value
  return clampSize(size.value.width, size.value.height)
})
const displayPosition = computed(() => {
  void viewportRevision.value
  return clampPosition(position.value.x, position.value.y, displaySize.value)
})
const windowStyle = computed(() => ({
  transform: `translate3d(${displayPosition.value.x}px, ${displayPosition.value.y}px, 0)`,
  zIndex: props.panel.layout.floating?.z ?? 100,
  width: `${displaySize.value.width}px`,
  height: `${displaySize.value.height}px`,
}))

function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= 640
}

function clampPosition(
  x: number,
  y: number,
  panelSize = displaySize.value,
): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y }
  const margin = 8
  return {
    x: Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - panelSize.width - margin)),
    y: Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - panelSize.height - margin)),
  }
}

function clampSize(width: number, height: number): { width: number; height: number } {
  if (typeof window === 'undefined') return { width, height }
  const margin = 16
  return {
    width: Math.min(Math.max(MIN_WIDTH, width), Math.max(MIN_WIDTH, window.innerWidth - margin)),
    height: Math.min(Math.max(MIN_HEIGHT, height), Math.max(MIN_HEIGHT, window.innerHeight - margin)),
  }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || isNarrowViewport()) return
  bringFloatingPanelToFront(props.panel.pluginId)
  const current = displayPosition.value
  dragStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: current.x,
    top: current.y,
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return
  dragPosition.value = clampPosition(
    dragStart.left + event.clientX - dragStart.x,
    dragStart.top + event.clientY - dragStart.y,
  )
}

function onPointerUp(event: PointerEvent): void {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return
  if (dragPosition.value) {
    setFloatingPanelPosition(props.panel.pluginId, dragPosition.value)
  }
  dragPosition.value = null
  dragStart = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onResizePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || isNarrowViewport()) return
  bringFloatingPanelToFront(props.panel.pluginId)
  event.preventDefault()
  event.stopPropagation()
  resizeStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    width: size.value.width,
    height: size.value.height,
  }
  window.addEventListener('pointermove', onResizePointerMove)
  window.addEventListener('pointerup', onResizePointerUp)
  window.addEventListener('pointercancel', onResizePointerUp)
}

function onResizePointerMove(event: PointerEvent): void {
  if (!resizeStart || event.pointerId !== resizeStart.pointerId) return
  resizeSize.value = clampSize(
    resizeStart.width + event.clientX - resizeStart.x,
    resizeStart.height + event.clientY - resizeStart.y,
  )
}

function onResizePointerUp(event: PointerEvent): void {
  if (!resizeStart || event.pointerId !== resizeStart.pointerId) return
  if (resizeSize.value) setFloatingPanelSize(props.panel.pluginId, resizeSize.value)
  resizeSize.value = null
  resizeStart = null
  window.removeEventListener('pointermove', onResizePointerMove)
  window.removeEventListener('pointerup', onResizePointerUp)
  window.removeEventListener('pointercancel', onResizePointerUp)
}

function onResizeKeydown(event: KeyboardEvent): void {
  if (isNarrowViewport()) return
  const step = event.shiftKey ? 40 : 16
  const widthDelta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
  const heightDelta = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
  if (!widthDelta && !heightDelta) return
  event.preventDefault()
  bringFloatingPanelToFront(props.panel.pluginId)
  const next = clampSize(
    displaySize.value.width + widthDelta,
    displaySize.value.height + heightDelta,
  )
  setFloatingPanelSize(props.panel.pluginId, next)
}

function onWindowPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  bringFloatingPanelToFront(props.panel.pluginId)
}

function onViewportResize(): void {
  viewportRevision.value += 1
}

function moveTo(placement: 'leftRail' | 'rightRail'): void {
  movePluginPanel(props.panel.pluginId, placement, route.name as string)
}

function onPanelEvent(event: Event): void {
  const root = contentRef.value
  if (!root) return
  dispatchPluginPanelDomEvent('floating', root, event, props.panel.pluginId)
}

watch(
  () => [props.panel.html, props.panel.revision],
  async () => {
    await nextTick()
    const root = contentRef.value
    if (root) notifyPluginPanelMounted(props.panel.pluginId, root)
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('resize', onViewportResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  window.removeEventListener('pointermove', onResizePointerMove)
  window.removeEventListener('pointerup', onResizePointerUp)
  window.removeEventListener('pointercancel', onResizePointerUp)
  window.removeEventListener('resize', onViewportResize)
})
</script>

<template>
  <section
    class="plugin-floating-window"
    :style="windowStyle"
    @pointerdown="onWindowPointerDown"
  >
    <header
      class="plugin-floating-window__titlebar"
      @pointerdown.prevent="onPointerDown"
    >
      <v-icon size="18">{{ panel.tabIcon }}</v-icon>
      <span class="plugin-floating-window__title text-truncate">{{ title }}</span>
      <v-menu location="bottom end">
        <template #activator="{ props: menuProps }">
          <v-btn
            icon="mdi-dots-horizontal"
            size="x-small"
            variant="text"
            :aria-label="$t('app.pluginPanelMenu')"
            v-bind="menuProps"
            @pointerdown.stop
          />
        </template>
        <v-list density="compact" min-width="10rem">
          <v-list-item
            :title="$t('app.pluginPanelDockLeft')"
            prepend-icon="mdi-dock-left"
            @click="moveTo('leftRail')"
          />
          <v-list-item
            :title="$t('app.pluginPanelDockRight')"
            prepend-icon="mdi-dock-right"
            @click="moveTo('rightRail')"
          />
          <v-divider />
          <v-list-item
            :title="$t('app.pluginPanelHide')"
            prepend-icon="mdi-eye-off-outline"
            @click="setFloatingPanelHidden(panel.pluginId, true)"
          />
        </v-list>
      </v-menu>
    </header>
    <div
      ref="contentRef"
      class="plugin-floating-window__content"
      data-plugin-panel-host
      :data-plugin-panel="panel.pluginId"
      v-html="panel.html"
      @click="onPanelEvent"
      @change="onPanelEvent"
      @input="onPanelEvent"
      @keydown="onPanelEvent"
    />
    <div
      class="plugin-floating-window__resize-handle"
      :aria-label="$t('app.pluginPanelResize')"
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      role="button"
      tabindex="0"
      @pointerdown="onResizePointerDown"
      @keydown="onResizeKeydown"
    />
  </section>
</template>

<style scoped>
.plugin-floating-window {
  position: fixed;
  max-width: calc(100vw - 1rem);
  max-height: calc(100dvh - 1rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.16);
  border-radius: var(--radius-sm);
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.3);
  pointer-events: auto;
}

.plugin-floating-window__titlebar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding-left: 0.75rem;
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-surface-bright), 0.72);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.plugin-floating-window__titlebar:active {
  cursor: grabbing;
}

.plugin-floating-window__title {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 600;
}

.plugin-floating-window__content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.plugin-floating-window__resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 1.25rem;
  height: 1.25rem;
  cursor: nwse-resize;
  touch-action: none;
}

.plugin-floating-window__resize-handle::after {
  content: '';
  position: absolute;
  right: 0.35rem;
  bottom: 0.35rem;
  width: 0.45rem;
  height: 0.45rem;
  border-right: 0.125rem solid rgba(var(--v-theme-on-surface), 0.45);
  border-bottom: 0.125rem solid rgba(var(--v-theme-on-surface), 0.45);
}

@media (max-width: 40rem) {
  .plugin-floating-window {
    inset: var(--header-height, 3.5rem) 0 var(--footer-height, 2rem) 0;
    width: auto;
    height: auto;
    border-radius: 0;
    transform: none !important;
  }

  .plugin-floating-window__titlebar {
    cursor: default;
  }

  .plugin-floating-window__resize-handle {
    display: none;
  }
}
</style>
