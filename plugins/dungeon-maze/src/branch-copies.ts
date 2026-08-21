import {
  isDungeonMazeState,
  snapshotDungeonMazeBranch,
  type DungeonMazeState,
  type DungeonMazeStates,
} from './maze.js'

export const DUNGEON_STATES_KEY = 'dungeonStates'

export type BranchCopyEvent = {
  conversationId: string
  parentBranchPath: string
  branchPath: string
}

export type PendingMazeState = {
  conversationId: string
  branchPath: string
  state: DungeonMazeState
}

export function readDungeonStateBuckets(
  settings: Record<string, unknown>,
  stateKey: string = DUNGEON_STATES_KEY,
): DungeonMazeStates {
  const raw = settings[stateKey]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const states: DungeonMazeStates = {}
  for (const [branchPath, value] of Object.entries(raw)) {
    if (isDungeonMazeState(value)) states[branchPath] = value
  }
  return states
}

/**
 * 冲刷分支创建时的迷宫快照队列。
 * 返回 true 表示写入出错且事件已重新入队，可重试。
 * 无父状态或子分支已有状态时丢弃对应事件，避免永久重排队。
 */
export async function flushDungeonMazeBranchCopies(args: {
  queue: BranchCopyEvent[]
  pendingState: PendingMazeState | null
  getConversationId: () => string
  getPluginSettings: () => Promise<Record<string, unknown>>
  patchPluginSettings: (partial: Record<string, unknown>) => Promise<unknown>
  stateKey?: string
}): Promise<boolean> {
  const stateKey = args.stateKey ?? DUNGEON_STATES_KEY
  const conversationId = args.getConversationId()
  const due = args.queue.filter((event) => event.conversationId === conversationId)
  if (!due.length) return false
  const rest = args.queue.filter((event) => event.conversationId !== conversationId)
  args.queue.length = 0
  args.queue.push(...rest)
  try {
    const settings = await args.getPluginSettings()
    if (args.getConversationId() !== conversationId) {
      args.queue.unshift(...due)
      return false
    }
    const states = readDungeonStateBuckets(settings, stateKey)
    if (args.pendingState && args.pendingState.conversationId === conversationId) {
      states[args.pendingState.branchPath] = args.pendingState.state
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
      // 子分支已有状态，或父分支尚无迷宫可复制：丢弃，避免无父状态时永久重排队。
      return false
    }
    await args.patchPluginSettings({ [stateKey]: nextStates })
    return false
  } catch {
    args.queue.unshift(...due)
    return true
  }
}
