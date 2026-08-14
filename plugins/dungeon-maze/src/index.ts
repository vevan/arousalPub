import {
  advanceDungeonCombat,
  beginDungeonCombat,
  HERO_COMBATANT_ID,
} from './battle.js'
import { DEFAULT_DUNGEON_CATALOG } from './catalog.js'
import {
  completeDungeonCombat,
  createDungeonMaze,
  findDungeonPath,
  isDungeonMazeState,
  isVisibleToHero,
  moveDungeonHero,
  resolveDungeonMapEvent,
  setDungeonCampRestMinutes,
  snapshotDungeonMazeBranch,
  type DungeonEventResolution,
  type DungeonMazeState,
  type DungeonMazeStates,
  type MazeEntity,
  type MazePoint,
} from './maze.js'

const PLUGIN_ID = 'dungeon-maze'
const PLACEMENT = 'rightRail'
const STATE_KEY = 'dungeonStates'

type PluginHost = {
  pluginKey(key: string): string
  t(key: string, params?: Record<string, unknown>): string
  registerSlotButton(slot: string, def: Record<string, unknown>): void
  registerStyles(css: string): void
  refreshSlotButtons(): void
  conversation: {
    getId(): string
    getActiveBranchPath(): Promise<string>
    getPluginSettings(): Promise<Record<string, unknown>>
    patchPluginSettings(partial: Record<string, unknown>): Promise<Record<string, unknown>>
    onPluginSettingsChanged(handler: (settings: Record<string, unknown>) => void): () => void
    acquirePluginHold(owner: string): string
    releasePluginHold(owner: string, token: string): void
    hasPluginHold(owner: string, token: string): boolean
  }
  lifecycle: {
    onTurnDataChanged(handler: () => void): () => void
    onBranchCreated(handler: (event: {
      conversationId: string
      parentBranchPath: string
      branchPath: string
    }) => void | Promise<void>): () => void
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
  return state.entities.find((entity) => entity.x === x && entity.y === y && !state.resolvedEntityIds.includes(entity.id))
}

function entityGlyph(entity: MazeEntity | undefined, state: DungeonMazeState, x: number, y: number): string {
  if (x === state.hero.x && y === state.hero.y) return '🧙'
  if (x === state.entrance.x && y === state.entrance.y) return '🚪'
  if (!entity) return ''
  if (entity.kind === 'boss') return '🐉'
  if (entity.kind === 'minion') return '👹'
  if (entity.kind === 'chest') return '📦'
  if (entity.kind === 'camp') return '🔥'
  return '🪤'
}

function renderMap(host: PluginHost, state: DungeonMazeState): string {
  const label = escapeHtml(host.t(tKey(host, 'mapLabel')))
  return `<div class="dm-map-wrap"><canvas class="dm-map" width="420" height="420" tabindex="0" role="img" aria-label="${label}" data-plugin-canvas="maze" data-plugin-keyboard></canvas></div>`
}

function count(state: DungeonMazeState, kind: MazeEntity['kind']): number {
  return state.entities.filter((entity) => entity.kind === kind && !state.resolvedEntityIds.includes(entity.id)).length
}

function renderActiveEvent(host: PluginHost, state: DungeonMazeState): string {
  const event = state.activeEvent
  if (!event) return ''
  if (state.activeCombat) return renderCombat(host, state)
  const description = event.kind === 'combat'
    ? host.t(tKey(host, 'combatEvent'), { rounds: event.rounds ?? 1, minutes: event.minutes })
    : event.kind === 'check'
      ? host.t(tKey(host, 'checkEvent'), { minutes: event.minutes })
      : host.t(tKey(host, 'campEvent'), { minutes: event.minutes })
  const resolveLabel = host.t(tKey(host, event.kind === 'combat' ? 'fight' : event.kind === 'check' ? 'check' : 'rest'))
  const skip = event.optional
    ? `<button type="button" class="dm-secondary" data-plugin-action="event:skip">${escapeHtml(host.t(tKey(host, 'skip')))}</button>`
    : ''
  const campControls = event.kind === 'camp'
    ? `<div class="dm-rest-duration"><button type="button" class="dm-secondary" data-plugin-action="event:camp:-30">−30</button><span>${event.minutes}m</span><button type="button" class="dm-secondary" data-plugin-action="event:camp:+30">+30</button></div>`
    : ''
  return `<section class="dm-event"><p>${escapeHtml(description)}</p><div>${campControls}<button type="button" class="dm-primary" data-plugin-action="event:resolve">${escapeHtml(resolveLabel)}</button>${skip}</div></section>`
}

function renderCombat(host: PluginHost, state: DungeonMazeState): string {
  const combat = state.activeCombat!
  const currentId = combat.initiative[combat.currentTurn]?.actorId
  const current = combat.combatants.find((candidate) => candidate.id === currentId)
  const rows = combat.combatants.map((combatant) =>
    `<li>${escapeHtml(combatant.name)}: ${combatant.hp}/${combatant.hpMax} HP</li>`,
  ).join('')
  const logs = combat.log.map((entry) =>
    `<li>${escapeHtml(entry.actorId)} → ${escapeHtml(entry.targetId)}: ${entry.hit ? `命中 ${entry.damageTotal}` : '未命中'}</li>`,
  ).join('')
  const finished = combat.outcome !== null
  const action = finished ? 'combat:complete' : 'combat:advance'
  const label = finished
    ? combat.outcome === 'victory' ? '结束战斗' : '结束战斗（败北）'
    : `${current?.name ?? '未知'} 行动`
  return `<section class="dm-event dm-combat"><p>战斗${finished ? `：${combat.outcome === 'victory' ? '胜利' : '败北'}` : '进行中'}</p><ul>${rows}</ul><ol class="dm-combat-log">${logs}</ol><button type="button" class="dm-primary" data-plugin-action="${action}">${escapeHtml(label)}</button></section>`
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
    renderActiveEvent(host, state),
    `<p class="dm-legend" data-plugin-live-text="elapsed">${escapeHtml(host.t(tKey(host, 'elapsed'), { minutes: state.elapsedMinutes }))}</p>`,
    `<p class="dm-legend">${escapeHtml(host.t(tKey(host, 'moveHint')))}</p>`,
    `<p class="dm-legend"><b>🧙</b> ${escapeHtml(host.t(tKey(host, 'hero')))} · <b>🐉</b> ${escapeHtml(host.t(tKey(host, 'boss')))} · <b>👹</b> ${count(state, 'minion')} · <b>📦</b> ${count(state, 'chest')} · <b>🪤</b> ${count(state, 'trap')} · <b>🔥</b> ${count(state, 'camp')}</p>`,
    '</section>',
  ].join('\n')
}

const STYLES = `
.dungeon-maze-panel{padding:10px;display:flex;flex-direction:column;gap:10px;min-width:0}
.dm-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.dm-header h3{margin:0;font-size:1rem}.dm-header p,.dm-legend,.dm-empty{margin:3px 0 0;font-size:.75rem;opacity:.7}
.dm-header-actions{display:flex;gap:4px}.dm-map-wrap{width:100%;min-width:0;overflow:hidden}.dm-map{display:block;box-sizing:border-box;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));background:oklch(.16 .015 55);cursor:pointer;touch-action:manipulation}.dm-map:focus-visible{outline:2px solid rgb(var(--v-theme-primary));outline-offset:2px}
.dm-event{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:6px;background:rgba(var(--v-theme-primary),.08)}.dm-event p{margin:0;font-size:.8rem}.dm-event>div,.dm-rest-duration{display:flex;align-items:center;gap:6px;flex-shrink:0}.dm-rest-duration span{min-width:36px;text-align:center;font-size:.75rem}.dm-primary,.dm-secondary,.dm-icon{border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:6px;color:rgb(var(--v-theme-on-surface));cursor:pointer}.dm-primary,.dm-icon{background:rgba(var(--v-theme-primary),.12)}.dm-primary,.dm-secondary{padding:7px 10px}.dm-icon{width:28px;height:28px;font-size:18px}.dm-secondary{background:transparent}.dm-primary:hover,.dm-icon:hover{background:rgba(var(--v-theme-primary),.22)}.dm-secondary:hover{background:rgba(var(--v-theme-on-surface),.08)}
`

let revision = 0
let keyboardMoveInFlight = false
let autoMoveInFlight = false
let autoMoveRun = 0
let canvas: HTMLCanvasElement | null = null
let elapsedElement: HTMLElement | null = null
let canvasResizeObserver: ResizeObserver | null = null
type ScopedDungeonState = {
  state: DungeonMazeState
  conversationId: string
  branchPath: string
}

let pendingState: ScopedDungeonState | null = null
let boundConversationId = ''
let boundBranchPath = ''
let stateWrite: Promise<unknown> = Promise.resolve()
let combatHoldToken: string | null = null
let unsubscribeBranchCreated: (() => void) | null = null
const ignoredStateSignatures = new Set<string>()
const pendingBranchCopies: Array<{
  conversationId: string
  parentBranchPath: string
  branchPath: string
}> = []

function discardTransientMaze(): void {
  autoMoveRun += 1
  autoMoveInFlight = false
  keyboardMoveInFlight = false
  pendingState = null
}

function acquireCombatHold(host: PluginHost): void {
  if (combatHoldToken && host.conversation.hasPluginHold(PLUGIN_ID, combatHoldToken)) return
  combatHoldToken = host.conversation.acquirePluginHold(PLUGIN_ID)
}

function releaseCombatHold(host: PluginHost): void {
  if (!combatHoldToken) return
  host.conversation.releasePluginHold(PLUGIN_ID, combatHoldToken)
  combatHoldToken = null
}

function syncScope(conversationId: string, branchPath: string): boolean {
  if (conversationId === boundConversationId && branchPath === boundBranchPath) return false
  discardTransientMaze()
  boundConversationId = conversationId
  boundBranchPath = branchPath
  return true
}

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
  if (pendingState && host.conversation.getId() === pendingState.conversationId) {
    void persistState(host, pendingState)
  }
}

function stateSignature(state: DungeonMazeState): string {
  return `${state.seed}:${state.hero.x}:${state.hero.y}:${state.elapsedMinutes}:${state.restedMinutes}:${state.resolvedEntityIds.join(',')}:${state.activeEvent?.entityId ?? ''}:${state.activeEvent?.minutes ?? ''}:${JSON.stringify(state.activeCombat)}:${state.explored.flat().map((value) => value ? '1' : '0').join('')}`
}

function readStateBuckets(settings: Record<string, unknown>): DungeonMazeStates {
  const raw = settings[STATE_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const states: DungeonMazeStates = {}
  for (const [branchPath, value] of Object.entries(raw)) {
    if (isDungeonMazeState(value)) states[branchPath] = value
  }
  return states
}

function enqueueStateJob<T>(job: () => Promise<T>): Promise<T> {
  const result = stateWrite.catch(() => undefined).then(job)
  stateWrite = result.catch(() => undefined)
  return result
}

/** 返回 true 表示写入出错，事件已重新排队等待重试。 */
async function flushBranchCopies(host: PluginHost): Promise<boolean> {
  const conversationId = host.conversation.getId()
  const due = pendingBranchCopies.filter((event) => event.conversationId === conversationId)
  if (!due.length) return false
  const rest = pendingBranchCopies.filter((event) => event.conversationId !== conversationId)
  pendingBranchCopies.length = 0
  pendingBranchCopies.push(...rest)
  try {
    const settings = await host.conversation.getPluginSettings()
    if (host.conversation.getId() !== conversationId) {
      pendingBranchCopies.unshift(...due)
      return false
    }
    const states = readStateBuckets(settings)
    if (pendingState && pendingState.conversationId === conversationId) {
      states[pendingState.branchPath] = pendingState.state
    }
    let nextStates = states
    for (const event of due) {
      nextStates = snapshotDungeonMazeBranch(
        nextStates,
        event.parentBranchPath,
        event.branchPath,
      )
    }
    if (nextStates === states) {
      for (const event of due) {
        if (!states[event.branchPath]) pendingBranchCopies.push(event)
      }
      return false
    }
    await host.conversation.patchPluginSettings({ [STATE_KEY]: nextStates })
    return false
  } catch {
    pendingBranchCopies.unshift(...due)
    return true
  }
}

function persistState(host: PluginHost, scoped: ScopedDungeonState): Promise<void> {
  if (host.conversation.getId() !== scoped.conversationId) return stateWrite
  pendingState = scoped
  const signature = stateSignature(scoped.state)
  ignoredStateSignatures.add(signature)
  stateWrite = stateWrite.catch(() => undefined).then(async () => {
    if (host.conversation.getId() !== scoped.conversationId) return
    const activeBranchPath = await host.conversation.getActiveBranchPath()
    if (
      host.conversation.getId() !== scoped.conversationId ||
      activeBranchPath !== scoped.branchPath
    ) return
    const settings = await host.conversation.getPluginSettings()
    if (host.conversation.getId() !== scoped.conversationId) return
    const states = readStateBuckets(settings)
    await host.conversation.patchPluginSettings({
      [STATE_KEY]: { ...states, [scoped.branchPath]: scoped.state },
    })
    if (
      host.conversation.getId() === scoped.conversationId &&
      pendingState &&
      pendingState.conversationId === scoped.conversationId &&
      pendingState.branchPath === scoped.branchPath &&
      stateSignature(pendingState.state) === signature
    ) {
      pendingState = null
    }
  })
  return stateWrite
}

async function mutateState(
  host: PluginHost,
  mutate: (state: DungeonMazeState) => DungeonMazeState | null,
  after: (next: DungeonMazeState) => Promise<void> | void,
): Promise<void> {
  const scoped = await readState(host)
  if (!scoped || host.conversation.getId() !== scoped.conversationId) return
  const next = mutate(scoped.state)
  if (!next) return
  if (host.conversation.getId() !== scoped.conversationId) return
  await persistState(host, { ...scoped, state: next })
  if (host.conversation.getId() !== scoped.conversationId) return
  await after(next)
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

async function readState(host: PluginHost): Promise<ScopedDungeonState | null> {
  const conversationId = host.conversation.getId()
  const branchPath = await host.conversation.getActiveBranchPath()
  if (host.conversation.getId() !== conversationId) return null
  if (syncScope(conversationId, branchPath)) releaseCombatHold(host)
  if (
    pendingState &&
    pendingState.conversationId === conversationId &&
    pendingState.branchPath === branchPath
  ) return pendingState
  const settings = await host.conversation.getPluginSettings()
  if (host.conversation.getId() !== conversationId) return null
  const state = readStateBuckets(settings)[branchPath]
  return state ? { state, conversationId, branchPath } : null
}

async function refreshPanel(host: PluginHost): Promise<void> {
  await enqueueStateJob(() => flushBranchCopies(host))
  const scoped = await readState(host)
  if (scoped?.state.activeCombat) acquireCombatHold(host)
  host.ui.panel.setHtml(PLACEMENT, PLUGIN_ID, renderPanel(host, scoped?.state ?? null), { revision: ++revision })
}

async function createMaze(host: PluginHost): Promise<void> {
  const conversationId = host.conversation.getId()
  releaseCombatHold(host)
  discardTransientMaze()
  const branchPath = await host.conversation.getActiveBranchPath()
  if (host.conversation.getId() !== conversationId) return
  syncScope(conversationId, branchPath)
  const state = createDungeonMaze()
  await persistState(host, { state, conversationId, branchPath })
  if (host.conversation.getId() !== conversationId) return
  await refreshPanel(host)
  host.ui.notify(host.t(tKey(host, 'created')), undefined, { level: 'success' })
}

async function moveHero(host: PluginHost, x: number, y: number): Promise<void> {
  await mutateState(host, (state) => moveDungeonHero(state, { x, y }), async (next) => {
    if (next.activeEvent) await refreshPanel(host)
    else drawMaze(host, next)
  })
}

async function resolveActiveEvent(host: PluginHost, resolution: DungeonEventResolution): Promise<void> {
  await mutateState(host, (state) => {
    if (state.activeEvent?.kind === 'combat' && resolution === 'resolve') {
      return beginDungeonCombat(state, DEFAULT_DUNGEON_CATALOG)
    }
    return resolveDungeonMapEvent(state, resolution)
  }, (next) => {
    if (next.activeCombat) acquireCombatHold(host)
    return refreshPanel(host)
  })
}

async function advanceCombat(host: PluginHost): Promise<void> {
  await mutateState(host, (state) => advanceDungeonCombat(state), () => refreshPanel(host))
}

async function completeCombat(host: PluginHost): Promise<void> {
  await mutateState(host, completeDungeonCombat, (next) => {
    if (!next.activeCombat) releaseCombatHold(host)
    return refreshPanel(host)
  })
}

async function adjustCampRest(host: PluginHost, delta: number): Promise<void> {
  await mutateState(host, (state) => {
    if (!state.activeEvent) return null
    return setDungeonCampRestMinutes(state, state.activeEvent.minutes + delta)
  }, () => refreshPanel(host))
}

async function moveHeroToExplored(host: PluginHost, x: number, y: number): Promise<void> {
  const run = ++autoMoveRun
  autoMoveInFlight = true
  try {
    const scoped = await readState(host)
    if (!scoped || run !== autoMoveRun || host.conversation.getId() !== scoped.conversationId) return
    const { conversationId, branchPath } = scoped
    const path = findDungeonPath(scoped.state, { x, y })
    if (!path?.length) return
    let next = scoped.state
    for (const point of path) {
      if (run !== autoMoveRun || host.conversation.getId() !== conversationId) return
      const moved = moveDungeonHero(next, point)
      if (!moved) return
      next = moved
      pendingState = { state: next, conversationId, branchPath }
      drawMaze(host, next)
      if (next.activeEvent) {
        await persistState(host, { state: next, conversationId, branchPath })
        if (host.conversation.getId() === conversationId) await refreshPanel(host)
        return
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 140))
    }
    if (run !== autoMoveRun || host.conversation.getId() !== conversationId) return
    await persistState(host, { state: next, conversationId, branchPath })
    if (host.conversation.getId() === conversationId) drawMaze(host, next)
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
  host.lifecycle.onTurnDataChanged(() => {
    const previousConversationId = boundConversationId
    const previousBranchPath = boundBranchPath
    void readState(host).then(() => {
      const scopeChanged =
        boundConversationId !== previousConversationId ||
        boundBranchPath !== previousBranchPath
      if (scopeChanged || !canvas?.isConnected) {
        void refreshPanel(host)
      }
    })
  })
  unsubscribeBranchCreated?.()
  unsubscribeBranchCreated = host.lifecycle.onBranchCreated(async (event) => {
    pendingBranchCopies.push(event)
    let failed = await enqueueStateJob(() => flushBranchCopies(host))
    if (failed && pendingBranchCopies.includes(event)) {
      failed = await enqueueStateJob(() => flushBranchCopies(host))
    }
    if (failed && pendingBranchCopies.includes(event)) {
      host.ui.notify(host.t(tKey(host, 'branchSnapshotFailed')), undefined, { level: 'error' })
    }
  })
  host.ui.panel.onEvent(PLACEMENT, PLUGIN_ID, {
    onAction: (event: { action: string }) => {
      if (event.action === 'create' || event.action === 'reset') void createMaze(host)
      if (event.action === 'event:resolve') void resolveActiveEvent(host, 'resolve')
      if (event.action === 'event:skip') void resolveActiveEvent(host, 'skip')
      if (event.action === 'combat:advance') void advanceCombat(host)
      if (event.action === 'combat:complete') void completeCombat(host)
      const campAdjustment = /^event:camp:([+-]\d+)$/.exec(event.action)
      if (campAdjustment) void adjustCampRest(host, Number(campAdjustment[1]))
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
          const scoped = await readState(host)
          if (scoped) await moveHero(host, scoped.state.hero.x + delta.x, scoped.state.hero.y + delta.y)
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
        if (state) drawMaze(host, state.state)
      })
    },
    onLiveTextMounted: (event) => {
      if (event.textId !== 'elapsed') return
      elapsedElement = event.element
      void readState(host).then((state) => {
        if (state) drawMaze(host, state.state)
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
    const rawStates = readStateBuckets(settings)
    const state = rawStates[boundBranchPath]
    if (state && ignoredStateSignatures.delete(stateSignature(state))) {
      drawMaze(host, state)
      return
    }
    void refreshPanel(host)
  })
  void refreshPanel(host)
}
