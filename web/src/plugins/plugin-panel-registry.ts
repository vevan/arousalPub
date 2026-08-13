import { ref, shallowRef } from 'vue'
import {
  ensurePluginPanelSanitizeHooks,
  sanitizePluginPanelHtml,
  sanitizePluginPanelHtmlInteractive,
} from '@/plugins/plugin-panel-sanitize'

export type PluginPanelPlacement = 'leftRail' | 'rightRail' | 'floating'
export type PluginPanelRailPlacement = Exclude<PluginPanelPlacement, 'floating'>
/** Plugins may opt into any named application route. */
export type PluginPanelRouteName = string

export const DEFAULT_PLUGIN_PANEL_ROUTES: PluginPanelRouteName[] = ['chat']

export interface PluginPanelRegisterOptions {
  placement: PluginPanelRailPlacement
  pluginId: string
  tabIcon: string
  tabLabelKey: string
  interactive?: boolean
  /** Omit → `['chat']` only. */
  routes?: PluginPanelRouteName[]
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

export interface PluginPanelCanvasEvent {
  canvas: HTMLCanvasElement
  canvasId: string
}

export interface PluginPanelLiveTextEvent {
  element: HTMLElement
  textId: string
}

export interface PluginPanelPointerEvent {
  canvasId: string
  x: number
  y: number
}

type PanelEventHandlers = {
  onInput?: (e: PluginPanelInputEvent) => void
  onAction?: (e: PluginPanelActionEvent) => void
  onCanvasMounted?: (e: PluginPanelCanvasEvent) => void
  onLiveTextMounted?: (e: PluginPanelLiveTextEvent) => void
  onPointer?: (e: PluginPanelPointerEvent) => void
  onKeydown?: (e: { key: string; repeat: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) => boolean | void
}

export interface PluginPanelEntry {
  defaultPlacement: PluginPanelRailPlacement
  pluginId: string
  tabIcon: string
  tabLabelKey: string
  interactive: boolean
  routes: PluginPanelRouteName[]
  html: string
  revision: number
}

export interface FloatingPanelPosition {
  x: number
  y: number
  z: number
  width?: number
  height?: number
}

export interface PluginPanelLayout {
  placement: PluginPanelPlacement
  hidden: boolean
  floating?: FloatingPanelPosition
}

export const PLUGIN_PANEL_HIDDEN_STORAGE_KEY = 'arousal-plugin-panel-hidden'
export const PLUGIN_PANEL_LAYOUT_STORAGE_KEY = 'arousal-plugin-panel-layouts'

const DEFAULT_PLUGIN_PANEL_HIDDEN: Record<PluginPanelRailPlacement, boolean> = {
  leftRail: true,
  rightRail: true,
}

function readPersistedPluginPanelHidden(): Record<PluginPanelRailPlacement, boolean> {
  try {
    const raw = localStorage.getItem(PLUGIN_PANEL_HIDDEN_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PLUGIN_PANEL_HIDDEN }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_PLUGIN_PANEL_HIDDEN }
    }
    const value = parsed as Record<string, unknown>
    return {
      leftRail:
        typeof value.leftRail === 'boolean'
          ? value.leftRail
          : DEFAULT_PLUGIN_PANEL_HIDDEN.leftRail,
      rightRail:
        typeof value.rightRail === 'boolean'
          ? value.rightRail
          : DEFAULT_PLUGIN_PANEL_HIDDEN.rightRail,
    }
  } catch {
    return { ...DEFAULT_PLUGIN_PANEL_HIDDEN }
  }
}

function persistPluginPanelHidden(
  state: Record<PluginPanelRailPlacement, boolean>,
): void {
  try {
    localStorage.setItem(PLUGIN_PANEL_HIDDEN_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* private mode / disabled storage */
  }
}

function isFloatingPosition(value: unknown): value is FloatingPanelPosition {
  if (!value || typeof value !== 'object') return false
  const position = value as Record<string, unknown>
  if (!['x', 'y', 'z'].every((key) =>
    typeof position[key] === 'number' && Number.isFinite(position[key]),
  )) return false
  return ['width', 'height'].every((key) =>
    position[key] === undefined || (
      typeof position[key] === 'number' &&
      Number.isFinite(position[key]) &&
      position[key] > 0
    ),
  )
}

function isPanelLayout(value: unknown): value is PluginPanelLayout {
  if (!value || typeof value !== 'object') return false
  const layout = value as Record<string, unknown>
  if (
    layout.placement !== 'leftRail' &&
    layout.placement !== 'rightRail' &&
    layout.placement !== 'floating'
  ) {
    return false
  }
  if (typeof layout.hidden !== 'boolean') return false
  return layout.floating === undefined || isFloatingPosition(layout.floating)
}

function readPersistedPanelLayouts(): Record<string, PluginPanelLayout> {
  try {
    const raw = localStorage.getItem(PLUGIN_PANEL_LAYOUT_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const layouts: Record<string, PluginPanelLayout> = {}
    for (const [pluginId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isPanelLayout(value)) layouts[pluginId] = value
    }
    return layouts
  } catch {
    return {}
  }
}

function persistPanelLayouts(layouts: Record<string, PluginPanelLayout>): void {
  try {
    localStorage.setItem(PLUGIN_PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layouts))
  } catch {
    /* private mode / disabled storage */
  }
}

export const pluginPanelHiddenState = ref<Record<PluginPanelRailPlacement, boolean>>(
  readPersistedPluginPanelHidden(),
)
export const pluginPanelLayoutState = ref<Record<string, PluginPanelLayout>>(
  readPersistedPanelLayouts(),
)
export const pluginPanelActiveTabState = ref<Record<PluginPanelRailPlacement, string | null>>({
  leftRail: null,
  rightRail: null,
})
export const pluginPanelRevision = ref(0)

const panels = new Map<string, PluginPanelEntry>()
const eventHandlers = new Map<string, PanelEventHandlers>()

function normalizePanelRoutes(
  routes?: PluginPanelRouteName[],
): PluginPanelRouteName[] {
  if (!routes?.length) return [...DEFAULT_PLUGIN_PANEL_ROUTES]
  return routes.filter((route): route is string => typeof route === 'string' && route.trim().length > 0)
}

function defaultFloatingPosition(): FloatingPanelPosition {
  const offset = Object.values(pluginPanelLayoutState.value).filter(
    (layout) => layout.placement === 'floating' && !layout.hidden,
  ).length
  return {
    x: 72 + offset * 28,
    y: 96 + offset * 28,
    z: getNextFloatingPanelZ(),
  }
}

function getNextFloatingPanelZ(): number {
  return Math.max(
    100,
    ...Object.values(pluginPanelLayoutState.value)
      .filter((layout) => layout.placement === 'floating')
      .map((layout) => layout.floating?.z ?? 100),
  ) + 1
}

function ensurePanelLayout(entry: PluginPanelEntry): PluginPanelLayout {
  const existing = pluginPanelLayoutState.value[entry.pluginId]
  if (existing) return existing
  const layout: PluginPanelLayout = {
    placement: entry.defaultPlacement,
    hidden: false,
  }
  pluginPanelLayoutState.value = {
    ...pluginPanelLayoutState.value,
    [entry.pluginId]: layout,
  }
  persistPanelLayouts(pluginPanelLayoutState.value)
  return layout
}

function updatePanelLayout(pluginId: string, layout: PluginPanelLayout): void {
  pluginPanelLayoutState.value = {
    ...pluginPanelLayoutState.value,
    [pluginId]: layout,
  }
  persistPanelLayouts(pluginPanelLayoutState.value)
  pluginPanelRevision.value += 1
}

export function isPanelVisibleOnRoute(
  entry: Pick<PluginPanelEntry, 'routes'>,
  routeName: string | null | undefined,
): boolean {
  if (!routeName) return false
  return entry.routes.includes(routeName)
}

export function getPluginPanelLayout(pluginId: string): PluginPanelLayout | null {
  const entry = panels.get(pluginId.trim())
  if (!entry) return null
  return ensurePanelLayout(entry)
}

export function getPluginPanelPlacement(pluginId: string): PluginPanelPlacement | null {
  return getPluginPanelLayout(pluginId)?.placement ?? null
}

export function getRegisteredPanels(
  placement?: PluginPanelPlacement,
): PluginPanelEntry[] {
  return [...panels.values()].filter((entry) => {
    if (!placement) return true
    return ensurePanelLayout(entry).placement === placement
  })
}

export function getRoutablePanels(
  placement: PluginPanelPlacement,
  routeName: string | null | undefined,
): PluginPanelEntry[] {
  return getRegisteredPanels(placement).filter((entry) =>
    isPanelVisibleOnRoute(entry, routeName),
  )
}

export function getFloatingPanels(
  routeName: string | null | undefined,
): Array<PluginPanelEntry & { layout: PluginPanelLayout }> {
  return getFloatingPanelsByHidden(routeName, false)
}

export function getHiddenFloatingPanels(
  routeName: string | null | undefined,
): Array<PluginPanelEntry & { layout: PluginPanelLayout }> {
  return getFloatingPanelsByHidden(routeName, true)
}

function getFloatingPanelsByHidden(
  routeName: string | null | undefined,
  hidden: boolean,
): Array<PluginPanelEntry & { layout: PluginPanelLayout }> {
  return getRoutablePanels('floating', routeName)
    .map((entry) => ({ entry, layout: ensurePanelLayout(entry) }))
    .filter(({ layout }) => layout.hidden === hidden)
    .sort((a, b) => (a.layout.floating?.z ?? 0) - (b.layout.floating?.z ?? 0))
    .map(({ entry, layout }) => ({ ...entry, layout }))
}

export function registerPluginPanel(opts: PluginPanelRegisterOptions): void {
  const pluginId = opts.pluginId.trim()
  if (!pluginId) return
  const prev = panels.get(pluginId)
  const entry: PluginPanelEntry = {
    defaultPlacement: opts.placement,
    pluginId,
    tabIcon: opts.tabIcon,
    tabLabelKey: opts.tabLabelKey,
    interactive: opts.interactive === true,
    routes: normalizePanelRoutes(opts.routes),
    html: prev?.html ?? '',
    revision: prev?.revision ?? 0,
  }
  panels.set(pluginId, entry)
  const layout = ensurePanelLayout(entry)
  if (layout.placement !== 'floating' && !pluginPanelActiveTabState.value[layout.placement]) {
    pluginPanelActiveTabState.value = {
      ...pluginPanelActiveTabState.value,
      [layout.placement]: pluginId,
    }
  }
  pluginPanelRevision.value += 1
}

export function setPluginPanelHtml(
  _placement: PluginPanelPlacement,
  pluginId: string,
  html: string,
  opts?: { revision?: number },
): void {
  ensurePluginPanelSanitizeHooks()
  const entry = panels.get(pluginId.trim())
  if (!entry) return
  entry.html = entry.interactive
    ? sanitizePluginPanelHtmlInteractive(html)
    : sanitizePluginPanelHtml(html)
  entry.revision = typeof opts?.revision === 'number' ? opts.revision : entry.revision + 1
  pluginPanelRevision.value += 1
}

/** Clear stored HTML for panels not visible on the active route. */
export function clearPanelHtmlForInactiveRoutes(
  routeName: string | null | undefined,
): void {
  let changed = false
  for (const entry of panels.values()) {
    if (!isPanelVisibleOnRoute(entry, routeName) && entry.html) {
      entry.html = ''
      entry.revision += 1
      changed = true
    }
  }
  if (changed) pluginPanelRevision.value += 1
}

export function onPluginPanelEvent(
  _placement: PluginPanelPlacement,
  pluginId: string,
  handlers: PanelEventHandlers,
): void {
  eventHandlers.set(pluginId.trim(), handlers)
}

export function movePluginPanel(
  pluginId: string,
  placement: PluginPanelPlacement,
  routeName?: string | null,
): void {
  const entry = panels.get(pluginId.trim())
  if (!entry) return
  const current = ensurePanelLayout(entry)
  const next: PluginPanelLayout = {
    placement,
    hidden: false,
    ...(placement === 'floating'
      ? {
          floating: {
            ...(current.floating ?? defaultFloatingPosition()),
            z: getNextFloatingPanelZ(),
          },
        }
      : {}),
  }
  updatePanelLayout(entry.pluginId, next)
  if (placement !== 'floating') {
    setPluginPanelHidden(placement, false)
    focusPluginPanelTab(placement, entry.pluginId, routeName)
  }
}

export function setFloatingPanelHidden(pluginId: string, hidden: boolean): void {
  const entry = panels.get(pluginId.trim())
  if (!entry) return
  const current = ensurePanelLayout(entry)
  if (current.placement !== 'floating') return
  updatePanelLayout(entry.pluginId, { ...current, hidden })
}

/** Restore every hidden floating panel visible on the current route. */
export function restoreHiddenFloatingPanels(
  routeName: string | null | undefined,
): void {
  for (const panel of getHiddenFloatingPanels(routeName)) {
    setFloatingPanelHidden(panel.pluginId, false)
    bringFloatingPanelToFront(panel.pluginId)
  }
}

export function setFloatingPanelPosition(
  pluginId: string,
  position: Pick<FloatingPanelPosition, 'x' | 'y'>,
): void {
  const entry = panels.get(pluginId.trim())
  if (!entry) return
  const current = ensurePanelLayout(entry)
  if (current.placement !== 'floating') return
  updatePanelLayout(entry.pluginId, {
    ...current,
    floating: { ...(current.floating ?? defaultFloatingPosition()), ...position },
  })
}

export function setFloatingPanelSize(
  pluginId: string,
  size: Pick<FloatingPanelPosition, 'width' | 'height'>,
): void {
  const entry = panels.get(pluginId.trim())
  if (!entry) return
  const current = ensurePanelLayout(entry)
  if (current.placement !== 'floating') return
  updatePanelLayout(entry.pluginId, {
    ...current,
    floating: { ...(current.floating ?? defaultFloatingPosition()), ...size },
  })
}

export function bringFloatingPanelToFront(pluginId: string): void {
  const entry = panels.get(pluginId.trim())
  if (!entry) return
  const current = ensurePanelLayout(entry)
  if (current.placement !== 'floating') return
  const currentZ = current.floating?.z ?? 100
  const maxZ = getNextFloatingPanelZ() - 1
  if (currentZ >= maxZ) return
  updatePanelLayout(entry.pluginId, {
    ...current,
    floating: { ...(current.floating ?? defaultFloatingPosition()), z: maxZ + 1 },
  })
}

export function focusPluginPanelTab(
  placement: PluginPanelRailPlacement,
  pluginId?: string,
  routeName?: string | null,
): void {
  if (pluginId?.trim()) {
    pluginPanelActiveTabState.value = {
      ...pluginPanelActiveTabState.value,
      [placement]: pluginId.trim(),
    }
    return
  }
  if (pluginPanelActiveTabState.value[placement]) return
  const candidates = routeName
    ? getRoutablePanels(placement, routeName)
    : getRegisteredPanels(placement)
  const first = candidates[0]
  if (first) {
    pluginPanelActiveTabState.value = {
      ...pluginPanelActiveTabState.value,
      [placement]: first.pluginId,
    }
  }
}

export function openPluginPanel(
  placement: PluginPanelRailPlacement,
  pluginId?: string,
  routeName?: string | null,
): void {
  setPluginPanelHidden(placement, false)
  focusPluginPanelTab(placement, pluginId, routeName)
}

export function isPluginPanelHidden(placement: PluginPanelRailPlacement): boolean {
  return pluginPanelHiddenState.value[placement]
}

export function setPluginPanelHidden(
  placement: PluginPanelRailPlacement,
  hidden: boolean,
): void {
  const next = { ...pluginPanelHiddenState.value, [placement]: hidden }
  pluginPanelHiddenState.value = next
  persistPluginPanelHidden(next)
}

export function getActivePanelHtml(
  placement: PluginPanelRailPlacement,
  routeName?: string | null,
): { pluginId: string; html: string; revision: number; interactive: boolean } | null {
  const candidates = routeName
    ? getRoutablePanels(placement, routeName)
    : getRegisteredPanels(placement)
  const selected = pluginPanelActiveTabState.value[placement]
  const entry = candidates.find((panel) => panel.pluginId === selected) ?? candidates[0]
  if (!entry) return null
  return {
    pluginId: entry.pluginId,
    html: entry.html,
    revision: entry.revision,
    interactive: entry.interactive,
  }
}

export function getPluginPanelHtml(pluginId: string): PluginPanelEntry | null {
  return panels.get(pluginId.trim()) ?? null
}

export function dispatchPluginPanelDomEvent(
  placement: PluginPanelPlacement,
  _root: HTMLElement,
  ev: Event,
  pluginId?: string,
): void {
  const activeId = pluginId?.trim() || (
    placement === 'floating' ? '' : pluginPanelActiveTabState.value[placement]
  )
  if (!activeId) return
  const handlers = eventHandlers.get(activeId)
  if (!handlers) return
  const target = ev.target
  if (!(target instanceof HTMLElement)) return
  if (ev.type === 'click') {
    const actionEl = target.closest('[data-plugin-action]')
    if (actionEl instanceof HTMLElement) {
      if (actionEl instanceof HTMLButtonElement && actionEl.disabled) return
      const action = actionEl.getAttribute('data-plugin-action')?.trim()
      if (action) handlers.onAction?.({ action, target: actionEl })
    }
  }
  if (ev.type === 'change' || ev.type === 'input') {
    const fieldEl = target.closest('[data-plugin-field]')
    if (fieldEl instanceof HTMLInputElement || fieldEl instanceof HTMLTextAreaElement) {
      const field = fieldEl.getAttribute('data-plugin-field')?.trim()
      if (field) {
        handlers.onInput?.({
          field,
          value: fieldEl.value,
          type: fieldEl instanceof HTMLInputElement ? fieldEl.type : 'textarea',
        })
      }
    }
  }
  if (ev.type === 'keydown' && ev instanceof KeyboardEvent && target.closest('[data-plugin-keyboard]')) {
    const handled = handlers.onKeydown?.({
      key: ev.key,
      repeat: ev.repeat,
      altKey: ev.altKey,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
    })
    if (handled) ev.preventDefault()
  }
  if (ev.type === 'click' && ev instanceof MouseEvent) {
    const canvas = target.closest('canvas[data-plugin-canvas]')
    if (!(canvas instanceof HTMLCanvasElement)) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    canvas.focus({ preventScroll: true })
    handlers.onPointer?.({
      canvasId: canvas.getAttribute('data-plugin-canvas')?.trim() ?? '',
      x: (ev.clientX - rect.left) * canvas.width / rect.width,
      y: (ev.clientY - rect.top) * canvas.height / rect.height,
    })
  }
}

export const pluginPanelMountRevision = shallowRef(0)

export function notifyPluginPanelMounted(pluginId?: string, root?: HTMLElement): void {
  pluginPanelMountRevision.value += 1
  if (!pluginId || !root) return
  const handlers = eventHandlers.get(pluginId.trim())
  if (!handlers) return
  for (const canvas of root.querySelectorAll('canvas[data-plugin-canvas]')) {
    handlers.onCanvasMounted?.({
      canvas,
      canvasId: canvas.getAttribute('data-plugin-canvas')?.trim() ?? '',
    })
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-plugin-live-text]')) {
    handlers.onLiveTextMounted?.({
      element,
      textId: element.getAttribute('data-plugin-live-text')?.trim() ?? '',
    })
  }
}
