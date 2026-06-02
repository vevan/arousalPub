/** 会话 turn 块切分（全局 user-preferences） */

export interface ChunkSettings {
  /** 新建块时每文件最多容纳的轮次数；已存在块以其 meta.turnsPerFile 为准 */
  turnsPerFile: number
}

export const CHUNK_SETTINGS_DEFAULTS: ChunkSettings = {
  turnsPerFile: 100,
}

export const CHUNK_TURNS_PER_FILE_MIN = 10
export const CHUNK_TURNS_PER_FILE_MAX = 500

export function normalizeChunkSettings(
  raw?: Partial<ChunkSettings> | null,
): ChunkSettings {
  let turnsPerFile =
    typeof raw?.turnsPerFile === 'number' && Number.isFinite(raw.turnsPerFile)
      ? Math.floor(raw.turnsPerFile)
      : CHUNK_SETTINGS_DEFAULTS.turnsPerFile
  turnsPerFile = Math.max(
    CHUNK_TURNS_PER_FILE_MIN,
    Math.min(CHUNK_TURNS_PER_FILE_MAX, turnsPerFile),
  )
  return { turnsPerFile }
}
