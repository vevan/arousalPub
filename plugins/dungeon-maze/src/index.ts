import {
  createDungeonMaze,
  findDungeonPath,
  isDungeonMazeState,
  isVisibleToHero,
  moveDungeonHero,
  type DungeonMazeState,
  type MazeEntity,
  type MazePoint,
} from './maze.js'

const PLUGIN_ID = 'dungeon-maze'
const PLACEMENT = 'rightRail'
const STATE_KEY = 'dungeonState'

type PluginHost = {
  pluginKey(key: string): string
  t(key: string, params?: Record<string, unknown>): string
  registerSlotButton(slot: string, def: Record<string, unknown>): void
  registerStyles(css: string): void
  refreshSlotButtons(): void
  conversation: {
    getPluginSettings(): Promise<Record<string, unknown>>
    patchPluginSettings(partial: Record<string, unknown>): Promise<Record<string, unknown>>
    onPluginSettingsChanged(handler: (settings: Record<string, unknown>) => void): () => void
  }
  ui: {
    notify(title: string, body?: string, opts?: { level?: 'info' | 'success' | 'warning' | 'error' }): void
    panel: {
      register(opts: Record<string, unknown>): void
      setHtml(placement: string, pluginId: string, html: string, opts?: { revision?: number }): void
      open(placement: string, pluginId?: string): void
      onEvent(
        placement: string,
        pluginId: string,
        handlers: {
          onAction?: (event: { action: string }) => void
          onCanvasMounted?: (event: { canvas: HTMLCanvasElement; canvasId: string }) => void
          onLiveTextMounted?: (event: { element: HTMLElement; textId: string }) => void
          onPointer?: (event: { canvasId: string; x: number; y: number }) => void
          onKeydown?: (event: { key: string; repeat: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) => boolean | void
        },
      ): void
    }
  }
}

function tKey(host: PluginHost, key: string): string {
  return host.pluginKey(key)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function entityAt(state: DungeonMazeState, x: number, y: number): MazeEntity | undefined {
  return state.entities.find((entity) => entity.x === x && entity.y === y)
}

function entityGlyph(entity: MazeEntity | undefined, state: DungeonMazeState, x: number, y: number): string {
  if (x === state.hero.x && y === state.hero.y) return '🧙'
  if (x === state.entrance.x && y === state.entrance.y) return '🚪'
  if (!entity) return ''
  if (entity.kind === 'boss') return '🐉'
  if (entity.kind === 'minion') return '👹'
  if (entity.kind === 'chest') return '📦'
  return '🪤'
}

function renderMap(host: PluginHost, state: DungeonMazeState): string {
  const label = escapeHtml(host.t(tKey(host, 'mapLabel')))
  return `<div class="dm-map-wrap"><canvas class="dm-map" width="420" height="420" tabindex="0" role="img" aria-label="${label}" data-plugin-canvas="maze" data-plugin-keyboard></canvas></div>`
}

function count(state: DungeonMazeState, kind: MazeEntity['kind']): number {
  return state.entities.filter((entity) => entity.kind === kind).length
}

function renderPanel(host: PluginHost, state: DungeonMazeState | null): string {
  if (!state) {
    return [
      '<section class="dungeon-maze-panel">',
      `<p class="dm-empty">${escapeHtml(host.t(tKey(host, 'empty')))}</p>`,
      `<button type="button" class="dm-primary" data-plugin-action="create">${escapeHtml(host.t(tKey(host, 'create')))}</button>`,
      '</section>',
    ].join('\n')
  }
  return [
    '<section class="dungeon-maze-panel">',
    '<header class="dm-header">',
    `<div><h3>${escapeHtml(host.t(tKey(host, 'title')))}</h3><p>${escapeHtml(host.t(tKey(host, 'seed'), { seed: state.seed }))}</p></div>`,
    `<div class="dm-header-actions"><button type="button" class="dm-icon" data-plugin-action="reset" title="${escapeHtml(host.t(tKey(host, 'reset')))}">↻</button></div>`,
    '</header>',
    renderMap(host, state),
    `<p class="dm-legend" data-plugin-live-text="elapsed">${escapeHtml(host.t(tKey(host, 'elapsed'), { minutes: state.elapsedMinutes }))}</p>`,
    `<p class="dm-legend">${escapeHtml(host.t(tKey(host, 'moveHint')))}</p>`,
    `<p class="dm-legend"><b>🧙</b> ${escapeHtml(host.t(tKey(host, 'hero')))} · <b>🐉</b> ${escapeHtml(host.t(tKey(host, 'boss')))} · <b>👹</b> ${count(state, 'minion')} · <b>📦</b> ${count(state, 'chest')} · <b>🪤</b> ${count(state, 'trap')}</p>`,
    '</section>',
  ].join('\n')
}

const STYLES = `
.dungeon-maze-panel{padding:10px;display:flex;flex-direction:column;gap:10px;min-width:0}
.dm-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.dm-header h3{margin:0;font-size:1rem}.dm-header p,.dm-legend,.dm-empty{margin:3px 0 0;font-size:.75rem;opacity:.7}
.dm-header-actions{display:flex;gap:4px}.dm-map-wrap{width:100%;min-width:0;overflow:hidden}.dm-map{display:block;box-sizing:border-box;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));background:oklch(.16 .015 55);cursor:pointer;touch-action:manipulation}.dm-map:focus-visible{outline:2px solid rgb(var(--v-theme-primary));outline-offset:2px}
.dm-primary,.dm-icon{border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:6px;background:rgba(var(--v-theme-primary),.12);color:rgb(var(--v-theme-on-surface));cursor:pointer}.dm-primary{padding:7px 10px;align-self:flex-start}.dm-icon{width:28px;height:28px;font-size:18px}.dm-primary:hover,.dm-icon:hover{background:rgba(var(--v-theme-primary),.22)}
`

let revision = 0
let keyboardMoveInFlight = false
let autoMoveInFlight = false
let autoMoveRun = 0
let canvas: HTMLCanvasElement | null = null
let elapsedElement: HTMLElement | null = null
let canvasResizeObserver: ResizeObserver | null = null
let pendingState: DungeonMazeState | null = null
let stateWrite = Promise.resolve()
const ignoredStateSignatures = new Set<string>()

function fitCanvasToContainer(): void {
  if (!canvas) return
  const container = canvas.parentElement
  if (!container) return
  const size = Math.max(210, container.clientWidth)
  canvas.style.width = `${size}px`
  canvas.style.height = `${size}px`
}

function cancelAutoMove(host: PluginHost): void {
  autoMoveRun += 1
  autoMoveInFlight = false
  if (pendingState) void persistState(host, pendingState)
}

function stateSignature(state: DungeonMazeState): string {
  return `${state.seed}:${state.hero.x}:${state.hero.y}:${state.elapsedMinutes}:${state.explored.flat().map((value) => value ? '1' : '0').join('')}`
}

function persistState(host: PluginHost, state: DungeonMazeState): Promise<void> {
  pendingState = state
  const signature = stateSignature(state)
  ignoredStateSignatures.add(signature)
  stateWrite = stateWrite.catch(() => undefined).then(async () => {
    await host.conversation.patchPluginSettings({ [STATE_KEY]: state })
    if (pendingState && stateSignature(pendingState) === signature) pendingState = null
  })
  return stateWrite
}

function drawMaze(host: PluginHost, state: DungeonMazeState): void {
  if (elapsedElement) elapsedElement.textContent = host.t(tKey(host, 'elapsed'), { minutes: state.elapsedMinutes })
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  const cellSize = canvas.width / state.width
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.font = '16px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const left = x * cellSize
      const top = y * cellSize
      const explored = state.explored[y]![x]
      const open = state.cells[y]![x] === 1
      context.fillStyle = !explored ? 'oklch(.23 .018 55)' : open ? 'oklch(.78 .05 82)' : 'oklch(.16 .015 55)'
      context.fillRect(left, top, cellSize, cellSize)
      if (isVisibleToHero(state, x, y)) {
        context.strokeStyle = 'oklch(.78 .04 82 / .2)'
        context.strokeRect(left + .5, top + .5, cellSize - 1, cellSize - 1)
      }
      const movable = open && isVisibleToHero(state, x, y) && Math.abs(state.hero.x - x) + Math.abs(state.hero.y - y) === 1
      if (movable) {
        context.strokeStyle = 'oklch(.65 .16 40)'
        context.lineWidth = 2
        context.strokeRect(left + 1, top + 1, cellSize - 2, cellSize - 2)
      }
      if (!explored) continue
      const glyph = entityGlyph(entityAt(state, x, y), state, x, y)
      if (glyph) context.fillText(glyph, left + cellSize / 2, top + cellSize / 2 + 1)
    }
  }
}

async function readState(host: PluginHost): Promise<DungeonMazeState | null> {
  if (pendingState) return pendingState
  const settings = await host.conversation.getPluginSettings()
  const state = settings[STATE_KEY]
  return isDungeonMazeState(state) ? state : null
}

async function refreshPanel(host: PluginHost): Promise<void> {
  const state = await readState(host)
  host.ui.panel.setHtml(PLACEMENT, PLUGIN_ID, renderPanel(host, state), { revision: ++revision })
}

async function createMaze(host: PluginHost): Promise<void> {
  const state = createDungeonMaze()
  await host.conversation.patchPluginSettings({ [STATE_KEY]: state })
  await refreshPanel(host)
  host.ui.notify(host.t(tKey(host, 'created')), undefined, { level: 'success' })
}

async function moveHero(host: PluginHost, x: number, y: number): Promise<void> {
  const state = await readState(host)
  if (!state) return
  const next = moveDungeonHero(state, { x, y })
  if (!next) return
  await persistState(host, next)
  drawMaze(host, next)
}

async function moveHeroToExplored(host: PluginHost, x: number, y: number): Promise<void> {
  const run = ++autoMoveRun
  autoMoveInFlight = true
  const state = await readState(host)
  if (!state || run !== autoMoveRun) return
  const path = findDungeonPath(state, { x, y })
  if (!path?.length) {
    autoMoveInFlight = false
    return
  }
  try {
    let next = state
    for (const point of path) {
      if (run !== autoMoveRun) return
      const moved = moveDungeonHero(next, point)
      if (!moved) return
      next = moved
      pendingState = next
      drawMaze(host, next)
      await new Promise<void>((resolve) => setTimeout(resolve, 140))
    }
    if (run !== autoMoveRun) return
    await persistState(host, next)
    drawMaze(host, next)
  } finally {
    if (run === autoMoveRun) autoMoveInFlight = false
  }
}

function movementForKey(key: string): MazePoint | null {
  switch (key.toLowerCase()) {
    case 'w':
    case 'arrowup':
      return { x: 0, y: -1 }
    case 's':
    case 'arrowdown':
      return { x: 0, y: 1 }
    case 'a':
    case 'arrowleft':
      return { x: -1, y: 0 }
    case 'd':
    case 'arrowright':
      return { x: 1, y: 0 }
    default:
      return null
  }
}

export function register(host: PluginHost): void {
  host.registerStyles(STYLES)
  host.ui.panel.register({
    placement: PLACEMENT,
    pluginId: PLUGIN_ID,
    tabIcon: 'mdi-grid-large',
    tabLabelKey: tKey(host, 'title'),
    interactive: true,
  })
  host.registerSlotButton('composer-toolbar', {
    id: `${PLUGIN_ID}-open`,
    icon: 'mdi-grid-large',
    tooltipKey: tKey(host, 'open'),
    onClick: () => {
      host.ui.panel.open(PLACEMENT, PLUGIN_ID)
      void refreshPanel(host)
    },
  })
  host.ui.panel.onEvent(PLACEMENT, PLUGIN_ID, {
    onAction: (event: { action: string }) => {
      if (event.action === 'create' || event.action === 'reset') void createMaze(host)
      const match = /^move:(\d+):(\d+)$/.exec(event.action)
      if (match) void moveHero(host, Number(match[1]), Number(match[2]))
    },
    onKeydown: (event) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return false
      if (event.key === 'Escape' && autoMoveInFlight) {
        cancelAutoMove(host)
        return true
      }
      const delta = movementForKey(event.key)
      if (!delta) return false
      if (keyboardMoveInFlight) return true
      if (autoMoveInFlight) {
        cancelAutoMove(host)
        return true
      }
      keyboardMoveInFlight = true
      void (async () => {
        try {
          const state = await readState(host)
          if (state) await moveHero(host, state.hero.x + delta.x, state.hero.y + delta.y)
        } finally {
          keyboardMoveInFlight = false
        }
      })()
      return true
    },
    onCanvasMounted: (event) => {
      if (event.canvasId !== 'maze') return
      canvasResizeObserver?.disconnect()
      canvas = event.canvas
      fitCanvasToContainer()
      const container = canvas.parentElement
      if (container && typeof ResizeObserver !== 'undefined') {
        canvasResizeObserver = new ResizeObserver(() => fitCanvasToContainer())
        canvasResizeObserver.observe(container)
      }
      void readState(host).then((state) => {
        if (state) drawMaze(host, state)
      })
    },
    onLiveTextMounted: (event) => {
      if (event.textId !== 'elapsed') return
      elapsedElement = event.element
      void readState(host).then((state) => {
        if (state) drawMaze(host, state)
      })
    },
    onPointer: (event) => {
      if (event.canvasId !== 'maze') return
      if (autoMoveInFlight) {
        cancelAutoMove(host)
        return
      }
      void moveHeroToExplored(host, Math.floor(event.x / 20), Math.floor(event.y / 20))
    },
  })
  host.conversation.onPluginSettingsChanged((settings) => {
    const state = settings[STATE_KEY]
    if (isDungeonMazeState(state) && ignoredStateSignatures.delete(stateSignature(state))) {
      drawMaze(host, state)
      return
    }
    void refreshPanel(host)
  })
  void refreshPanel(host)
}
