import { ref, shallowRef } from 'vue'
import {
  ensurePluginPanelSanitizeHooks,
  sanitizePluginPanelHtml,
  sanitizePluginPanelHtmlInteractive,
} from '@/plugins/plugin-panel-sanitize'

export type PluginPanelPlacement = 'leftRail' | 'rightRail'

export interface PluginPanelRegisterOptions {
  placement: PluginPanelPlacement
  pluginId: string
  tabIcon: string
  tabLabelKey: string
  interactive?: boolean
}

export interface PluginPanelInputEvent {
  field: string
  value: string
  type: string
}

export interface PluginPanelActionEvent {
  action: string
  target: HTMLElement
}

type PanelEventHandlers = {
  onInput?: (e: PluginPanelInputEvent) => void
  onAction?: (e: PluginPanelActionEvent) => void
}

export interface PluginPanelEntry {
  placement: PluginPanelPlacement
  pluginId: string
  tabIcon: string
  tabLabelKey: string
  interactive: boolean
  html: string
  revision: number
}

export const pluginPanelHiddenState = ref<Record<PluginPanelPlacement, boolean>>({
  leftRail: false,
  rightRail: true,
})
export const pluginPanelActiveTabState = ref<Record<PluginPanelPlacement, string | null>>({
  leftRail: null,
  rightRail: null,
})
export const pluginPanelRevision = ref(0)

const panels = new Map<string, PluginPanelEntry>()
const eventHandlers = new Map<string, PanelEventHandlers>()

function panelKey(placement: PluginPanelPlacement, pluginId: string): string {
  return `${placement}::${pluginId}`
}

export function getRegisteredPanels(
  placement: PluginPanelPlacement,
): PluginPanelEntry[] {
  return [...panels.values()].filter((p) => p.placement === placement)
}

export function registerPluginPanel(opts: PluginPanelRegisterOptions): void {
  const pluginId = opts.pluginId.trim()
  if (!pluginId) return
  const key = panelKey(opts.placement, pluginId)
  const prev = panels.get(key)
  panels.set(key, {
    placement: opts.placement,
    pluginId,
    tabIcon: opts.tabIcon,
    tabLabelKey: opts.tabLabelKey,
    interactive: opts.interactive === true,
    html: prev?.html ?? '',
    revision: prev?.revision ?? 0,
  })
  if (!pluginPanelActiveTabState.value[opts.placement]) {
    pluginPanelActiveTabState.value = {
      ...pluginPanelActiveTabState.value,
      [opts.placement]: pluginId,
    }
  }
  pluginPanelRevision.value += 1
}

export function setPluginPanelHtml(
  placement: PluginPanelPlacement,
  pluginId: string,
  html: string,
  opts?: { revision?: number },
): void {
  ensurePluginPanelSanitizeHooks()
  const key = panelKey(placement, pluginId.trim())
  const entry = panels.get(key)
  if (!entry) return
  const clean = entry.interactive
    ? sanitizePluginPanelHtmlInteractive(html)
    : sanitizePluginPanelHtml(html)
  entry.html = clean
  if (typeof opts?.revision === 'number') {
    entry.revision = opts.revision
  } else {
    entry.revision += 1
  }
  pluginPanelRevision.value += 1
}

export function onPluginPanelEvent(
  placement: PluginPanelPlacement,
  pluginId: string,
  handlers: PanelEventHandlers,
): void {
  eventHandlers.set(panelKey(placement, pluginId.trim()), handlers)
}

export function focusPluginPanelTab(
  placement: PluginPanelPlacement,
  pluginId?: string,
): void {
  if (pluginId?.trim()) {
    pluginPanelActiveTabState.value = {
      ...pluginPanelActiveTabState.value,
      [placement]: pluginId.trim(),
    }
  } else if (!pluginPanelActiveTabState.value[placement]) {
    const first = getRegisteredPanels(placement)[0]
    if (first) {
      pluginPanelActiveTabState.value = {
        ...pluginPanelActiveTabState.value,
        [placement]: first.pluginId,
      }
    }
  }
}

export function openPluginPanel(
  placement: PluginPanelPlacement,
  pluginId?: string,
): void {
  setPluginPanelHidden(placement, false)
  focusPluginPanelTab(placement, pluginId)
}

export function isPluginPanelHidden(placement: PluginPanelPlacement): boolean {
  return pluginPanelHiddenState.value[placement]
}

export function setPluginPanelHidden(
  placement: PluginPanelPlacement,
  hidden: boolean,
): void {
  pluginPanelHiddenState.value = {
    ...pluginPanelHiddenState.value,
    [placement]: hidden,
  }
}

export function getActivePanelHtml(
  placement: PluginPanelPlacement,
): { pluginId: string; html: string; revision: number; interactive: boolean } | null {
  let id = pluginPanelActiveTabState.value[placement]
  if (!id) {
    const first = getRegisteredPanels(placement)[0]
    id = first?.pluginId ?? null
  }
  if (!id) return null
  const entry = panels.get(panelKey(placement, id))
  if (!entry) {
    const first = getRegisteredPanels(placement)[0]
    if (!first) return null
    return {
      pluginId: first.pluginId,
      html: first.html,
      revision: first.revision,
      interactive: first.interactive,
    }
  }
  return {
    pluginId: entry.pluginId,
    html: entry.html,
    revision: entry.revision,
    interactive: entry.interactive,
  }
}

export function dispatchPluginPanelDomEvent(
  placement: PluginPanelPlacement,
  root: HTMLElement,
  ev: Event,
): void {
  const active = pluginPanelActiveTabState.value[placement]
  if (!active) return
  const entry = panels.get(panelKey(placement, active))
  if (!entry) return
  const handlers = eventHandlers.get(panelKey(placement, active))
  if (!handlers) return

  const target = ev.target
  if (!(target instanceof HTMLElement)) return

  if (ev.type === 'click') {
    const actionEl = target.closest('[data-tk-action]')
    if (actionEl instanceof HTMLElement) {
      if (
        actionEl instanceof HTMLButtonElement &&
        actionEl.disabled
      ) {
        return
      }
      const action = actionEl.getAttribute('data-tk-action')?.trim()
      if (action) {
        handlers.onAction?.({ action, target: actionEl })
      }
    }
  }

  if (ev.type === 'change' || ev.type === 'input') {
    const fieldEl = target.closest('[data-tk-field]')
    if (fieldEl instanceof HTMLInputElement || fieldEl instanceof HTMLTextAreaElement) {
      const field = fieldEl.getAttribute('data-tk-field')?.trim()
      if (field) {
        handlers.onInput?.({
          field,
          value: fieldEl.value,
          type: fieldEl instanceof HTMLInputElement ? fieldEl.type : 'textarea',
        })
      }
    }
  }
}

export const pluginPanelMountRevision = shallowRef(0)

export function notifyPluginPanelMounted(): void {
  pluginPanelMountRevision.value += 1
}
