import path from 'node:path'

const TURN_CHUNK_BASENAME_RE = /^turn-\d{6}-\d{6}\.json$/i

/** 规范化 branchPath："" | "branch1" | "branch1/nested"；禁止 .. 与绝对路径 */
export function normalizeBranchPath(raw: string): string {
  const s = raw.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '')
  if (!s) return ''
  const segments = s.split('/').filter(Boolean)
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error(`invalid branchPath segment: ${seg}`)
    }
  }
  return segments.join('/')
}

/** 规范化 chunk 文件名：仅 turn-XXXXXX-XXXXXX.json */
export function normalizeChunkBasename(raw: string): string {
  const base = path.basename(raw.replace(/\\/g, '/')).trim()
  if (!TURN_CHUNK_BASENAME_RE.test(base)) {
    throw new Error(`invalid chunkFileName: ${raw}`)
  }
  return base
}

/** 会话根相对路径（日志 / 读盘） */
export function chunkStorageRelativePath(
  branchPath: string,
  chunkFileName: string,
): string {
  const bp = normalizeBranchPath(branchPath)
  const fn = normalizeChunkBasename(chunkFileName)
  return bp ? `${bp}/${fn}` : fn
}

/** 按 chunk 位置分组用的稳定键 */
export function chunkLocationKey(
  branchPath: string,
  chunkFileName: string,
): string {
  return `${normalizeBranchPath(branchPath)}\0${normalizeChunkBasename(chunkFileName)}`
}

/** 将 index / links 中的相对路径拆为 branchPath + basename */
export function splitChunkStoragePath(relativePath: string): {
  branchPath: string
  chunkFileName: string
} {
  const normalized = relativePath.replace(/\\/g, '/').trim()
  const slash = normalized.lastIndexOf('/')
  if (slash < 0) {
    return {
      branchPath: '',
      chunkFileName: normalizeChunkBasename(normalized),
    }
  }
  return {
    branchPath: normalizeBranchPath(normalized.slice(0, slash)),
    chunkFileName: normalizeChunkBasename(normalized.slice(slash + 1)),
  }
}

/** 主路径 chunk 定位（当前实现仅有 basename） */
export function mainPathChunkLocation(chunkFileName: string): {
  branchPath: string
  chunkFileName: string
} {
  return { branchPath: '', chunkFileName: normalizeChunkBasename(chunkFileName) }
}

/**
 * active 分支及其祖先 branchPath（含主路径 ""）。
 * 例：`branch1/nested` → `["", "branch1", "branch1/nested"]`
 */
export function branchAncestorPaths(activeBranchPath: string): string[] {
  const active = normalizeBranchPath(activeBranchPath)
  if (!active) return ['']
  const segments = active.split('/')
  const out: string[] = ['']
  for (let i = 0; i < segments.length; i++) {
    out.push(segments.slice(0, i + 1).join('/'))
  }
  return out
}

/** memory 召回默认范围：当前 active 分支及其祖先 */
export function buildAllowedBranchPathsForActive(
  activeBranchPath: string | null | undefined,
): Set<string> {
  return new Set(branchAncestorPaths(activeBranchPath ?? ''))
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''")
}

/**
 * Lance 向量检索预过滤：仅允许当前分支链（主路径 + 祖先 + active）。
 * 返回 undefined 表示不过滤 branchPath（全库召回）。
 */
export function buildAllowedBranchPathsWhereSql(
  allowedBranchPaths: Set<string> | undefined,
): string | undefined {
  if (!allowedBranchPaths || allowedBranchPaths.size === 0) return undefined
  const paths = [...allowedBranchPaths].sort()
  if (paths.length === 1) {
    return `branchPath = '${escapeSqlString(paths[0])}'`
  }
  const list = paths.map((p) => `'${escapeSqlString(p)}'`).join(', ')
  return `branchPath IN (${list})`
}

/** 分支注册表 path 相对父目录，拼成会话根相对路径 */
export function resolveNestedBranchPath(
  parentBranchPath: string,
  relativePath: string,
): string {
  const rel = normalizeBranchPath(relativePath)
  if (!rel) return ''
  const parent = normalizeBranchPath(parentBranchPath)
  return parent ? `${parent}/${rel}` : rel
}
