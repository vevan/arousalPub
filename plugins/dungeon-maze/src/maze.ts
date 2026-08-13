export const MAZE_SIZE = 21

export type MazePoint = { x: number; y: number }
export type MazeEntityKind = 'boss' | 'minion' | 'chest' | 'trap' | 'camp'
export type MazeEntity = MazePoint & { id: string; kind: MazeEntityKind }
export type DungeonEventKind = 'combat' | 'check' | 'camp'
export type DungeonEventResolution = 'resolve' | 'skip'

export interface DungeonMapEvent {
  entityId: string
  kind: DungeonEventKind
  optional: boolean
  minutes: number
  rounds?: number
}

export interface MazeGenerationConfig {
  minionDensity: number
  chestDensity: number
  trapDensity: number
  campDensity: number
}

export const DEFAULT_GENERATION_CONFIG: MazeGenerationConfig = {
  minionDensity: 50,
  chestDensity: 110,
  trapDensity: 150,
  campDensity: 150,
}

const COMBAT_MINUTES_PER_ROUND = 0.5

export interface DungeonMazeState {
  version: 5
  width: number
  height: number
  seed: number
  generation: MazeGenerationConfig
  cells: number[][]
  entrance: MazePoint
  exit: MazePoint
  hero: MazePoint
  elapsedMinutes: number
  restedMinutes: number
  resolvedEntityIds: string[]
  activeEvent: DungeonMapEvent | null
  explored: boolean[][]
  entities: MazeEntity[]
}

type Random = () => number

function seededRandom(seed: number): Random {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function randomIndex(random: Random, length: number): number {
  return Math.floor(random() * length)
}

function samePoint(a: MazePoint, b: MazePoint): boolean {
  return a.x === b.x && a.y === b.y
}

export function hasLineOfSight(cells: number[][], from: MazePoint, to: MazePoint): boolean {
  let x = from.x
  let y = from.y
  const dx = Math.abs(to.x - x)
  const dy = Math.abs(to.y - y)
  const stepX = x < to.x ? 1 : -1
  const stepY = y < to.y ? 1 : -1
  let error = dx - dy
  while (x !== to.x || y !== to.y) {
    const twiceError = error * 2
    if (twiceError > -dy) {
      error -= dy
      x += stepX
    }
    if (twiceError < dx) {
      error += dx
      y += stepY
    }
    if (x === to.x && y === to.y) return true
    if (cells[y]?.[x] !== 1) return false
  }
  return true
}

function revealAround(cells: number[][], explored: boolean[][], point: MazePoint): boolean[][] {
  const next = explored.map((row) => [...row])
  for (let y = point.y - 2; y <= point.y + 2; y += 1) {
    for (let x = point.x - 2; x <= point.x + 2; x += 1) {
      if (next[y]?.[x] !== undefined && hasLineOfSight(cells, point, { x, y })) next[y]![x] = true
    }
  }
  return next
}

function selectEntranceAndExit(
  width: number,
  height: number,
  random: Random,
): { entrance: MazePoint; exit: MazePoint } {
  const validCells: MazePoint[] = []
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) validCells.push({ x, y })
  }

  const minimumDistance = Math.max(width, height)
  while (true) {
    const entrance = validCells[randomIndex(random, validCells.length)]!
    const exits = validCells.filter((candidate) =>
      Math.abs(entrance.x - candidate.x) + Math.abs(entrance.y - candidate.y) >= minimumDistance,
    )
    if (exits.length > 0) {
      return { entrance, exit: exits[randomIndex(random, exits.length)]! }
    }
  }
}

function carveMaze(
  width: number,
  height: number,
  entrance: MazePoint,
  exit: MazePoint,
  random: Random,
): number[][] {
  const cells = Array.from({ length: height }, () => Array<number>(width).fill(0))
  const visited = Array.from({ length: height }, () => Array<boolean>(width).fill(false))
  const stack: MazePoint[] = []
  let current = { ...entrance }
  cells[current.y]![current.x] = 1
  visited[current.y]![current.x] = true
  const directions = [
    { x: 0, y: -2, wallX: 0, wallY: -1 },
    { x: 0, y: 2, wallX: 0, wallY: 1 },
    { x: -2, y: 0, wallX: -1, wallY: 0 },
    { x: 2, y: 0, wallX: 1, wallY: 0 },
  ]

  while (true) {
    if (samePoint(current, exit)) {
      if (stack.length === 0) break
      current = stack.pop()!
      continue
    }
    const neighbors = directions.flatMap((direction) => {
      const x = current.x + direction.x
      const y = current.y + direction.y
      if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1 || visited[y]![x]) {
        return []
      }
      return [{ x, y, wallX: current.x + direction.wallX, wallY: current.y + direction.wallY }]
    })
    if (neighbors.length === 0) {
      if (stack.length === 0) break
      current = stack.pop()!
      continue
    }
    const next = neighbors[randomIndex(random, neighbors.length)]!
    cells[next.wallY]![next.wallX] = 1
    cells[next.y]![next.x] = 1
    visited[next.y]![next.x] = true
    stack.push(current)
    current = { x: next.x, y: next.y }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (cells[y]![x] !== 0) continue
      const horizontal = cells[y]![x - 1] === 1 && cells[y]![x + 1] === 1
      const vertical = cells[y - 1]![x] === 1 && cells[y + 1]![x] === 1
      if ((horizontal || vertical) && random() < 0.2) cells[y]![x] = 1
    }
  }
  return cells
}

function placeEntities(
  cells: number[][],
  entrance: MazePoint,
  exit: MazePoint,
  random: Random,
  generation: MazeGenerationConfig,
): MazeEntity[] {
  const available: MazePoint[] = []
  for (let y = 1; y < cells.length - 1; y += 1) {
    for (let x = 1; x < cells[y]!.length - 1; x += 1) {
      if (cells[y]![x] === 1 && !samePoint({ x, y }, entrance) && !samePoint({ x, y }, exit)) {
        available.push({ x, y })
      }
    }
  }
  const entities: MazeEntity[] = [{ id: 'boss-1', kind: 'boss', ...exit }]
  const take = (kind: Exclude<MazeEntityKind, 'boss'>, density: number) => {
    const count = Math.min(available.length, Math.round((cells.length * cells[0]!.length) / density))
    for (let index = 0; index < count; index += 1) {
      const point = available.splice(randomIndex(random, available.length), 1)[0]!
      entities.push({ id: `${kind}-${index + 1}`, kind, ...point })
    }
  }
  take('minion', generation.minionDensity)
  take('chest', generation.chestDensity)
  take('trap', generation.trapDensity)
  take('camp', generation.campDensity)
  return entities
}

export function createDungeonMaze(
  seed = Math.floor(Math.random() * 0xffffffff),
  generation: MazeGenerationConfig = DEFAULT_GENERATION_CONFIG,
): DungeonMazeState {
  const random = seededRandom(seed)
  const { entrance, exit } = selectEntranceAndExit(MAZE_SIZE, MAZE_SIZE, random)
  const cells = carveMaze(MAZE_SIZE, MAZE_SIZE, entrance, exit, random)
  return {
    version: 5,
    width: MAZE_SIZE,
    height: MAZE_SIZE,
    seed,
    generation: { ...generation },
    cells,
    entrance,
    exit,
    hero: { ...entrance },
    elapsedMinutes: 0,
    restedMinutes: 0,
    resolvedEntityIds: [],
    activeEvent: null,
    explored: revealAround(
      cells,
      Array.from({ length: MAZE_SIZE }, () => Array<boolean>(MAZE_SIZE).fill(false)),
      entrance,
    ),
    entities: placeEntities(cells, entrance, exit, random, generation),
  }
}

export function isVisibleToHero(state: DungeonMazeState, x: number, y: number): boolean {
  return Math.abs(state.hero.x - x) <= 2 && Math.abs(state.hero.y - y) <= 2 &&
    hasLineOfSight(state.cells, state.hero, { x, y })
}

export function moveDungeonHero(
  state: DungeonMazeState,
  destination: MazePoint,
): DungeonMazeState | null {
  const dx = Math.abs(destination.x - state.hero.x)
  const dy = Math.abs(destination.y - state.hero.y)
  if (state.activeEvent || dx + dy !== 1 || state.cells[destination.y]?.[destination.x] !== 1) return null
  const entity = state.entities.find((candidate) =>
    candidate.x === destination.x && candidate.y === destination.y && !state.resolvedEntityIds.includes(candidate.id),
  )
  return {
    ...state,
    hero: { ...destination },
    elapsedMinutes: state.elapsedMinutes + 1,
    activeEvent: entity ? createDungeonMapEvent(entity) : null,
    explored: revealAround(state.cells, state.explored, destination),
  }
}

export function createDungeonMapEvent(entity: MazeEntity): DungeonMapEvent {
  if (entity.kind === 'boss' || entity.kind === 'minion') {
    const rounds = entity.kind === 'boss' ? 10 : 6
    return {
      entityId: entity.id,
      kind: 'combat',
      optional: false,
      rounds,
      minutes: rounds * COMBAT_MINUTES_PER_ROUND,
    }
  }
  if (entity.kind === 'chest') return { entityId: entity.id, kind: 'check', optional: true, minutes: 3 }
  if (entity.kind === 'trap') return { entityId: entity.id, kind: 'check', optional: false, minutes: 3 }
  return { entityId: entity.id, kind: 'camp', optional: true, minutes: 30 }
}

export function setDungeonCampRestMinutes(
  state: DungeonMazeState,
  minutes: number,
): DungeonMazeState | null {
  const event = state.activeEvent
  if (!event || event.kind !== 'camp') return null
  const rounded = Math.max(30, Math.round(minutes / 30) * 30)
  return { ...state, activeEvent: { ...event, minutes: rounded } }
}

export function resolveDungeonMapEvent(
  state: DungeonMazeState,
  resolution: DungeonEventResolution,
): DungeonMazeState | null {
  const event = state.activeEvent
  if (!event || (resolution === 'skip' && !event.optional)) return null
  return {
    ...state,
    elapsedMinutes: state.elapsedMinutes + (resolution === 'resolve' ? event.minutes : 0),
    restedMinutes: state.restedMinutes + (resolution === 'resolve' && event.kind === 'camp' ? event.minutes : 0),
    resolvedEntityIds: resolution === 'resolve' && event.kind !== 'camp'
      ? [...state.resolvedEntityIds, event.entityId]
      : state.resolvedEntityIds,
    activeEvent: null,
  }
}

export function findDungeonPath(
  state: DungeonMazeState,
  destination: MazePoint,
): MazePoint[] | null {
  if (state.cells[destination.y]?.[destination.x] !== 1 || !state.explored[destination.y]?.[destination.x]) {
    return null
  }
  const startKey = `${state.hero.x},${state.hero.y}`
  const targetKey = `${destination.x},${destination.y}`
  const previous = new Map<string, MazePoint | null>([[startKey, null]])
  const queue: MazePoint[] = [{ ...state.hero }]
  const directions = [
    { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 },
  ]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    if (`${current.x},${current.y}` === targetKey) break
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y }
      const key = `${next.x},${next.y}`
      if (previous.has(key) || state.cells[next.y]?.[next.x] !== 1 || !state.explored[next.y]?.[next.x]) continue
      previous.set(key, current)
      queue.push(next)
    }
  }
  if (!previous.has(targetKey)) return null
  const path: MazePoint[] = []
  for (let point: MazePoint | null = { ...destination }; point && `${point.x},${point.y}` !== startKey;) {
    path.unshift(point)
    point = previous.get(`${point.x},${point.y}`) ?? null
  }
  return path
}

export function isDungeonMazeState(value: unknown): value is DungeonMazeState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<DungeonMazeState>
  return state.version === 5 && state.width === MAZE_SIZE && state.height === MAZE_SIZE &&
    Array.isArray(state.cells) && state.cells.length === MAZE_SIZE &&
    typeof state.hero?.x === 'number' && typeof state.hero?.y === 'number' &&
    Array.isArray(state.explored) && state.explored.length === MAZE_SIZE &&
    Array.isArray(state.entities) && typeof state.seed === 'number' &&
    typeof state.elapsedMinutes === 'number' && Number.isFinite(state.elapsedMinutes) && state.elapsedMinutes >= 0 &&
    typeof state.restedMinutes === 'number' && Number.isFinite(state.restedMinutes) && state.restedMinutes >= 0 &&
    Array.isArray(state.resolvedEntityIds) && (state.activeEvent === null || typeof state.activeEvent === 'object') &&
    typeof state.generation?.minionDensity === 'number' &&
    typeof state.generation?.chestDensity === 'number' &&
    typeof state.generation?.trapDensity === 'number' &&
    typeof state.generation?.campDensity === 'number'
}
