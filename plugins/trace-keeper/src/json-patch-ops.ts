/**
 * RFC6902 子集：replace / add / remove（DOC/30 §2.3.7）。
 * 整批原子：任一条失败则不改动原对象。
 */

export type TracePatchOp =
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }

export type ApplyTracePatchResult =
  | { ok: true; state: Record<string, unknown>; applied: number }
  | { ok: false; code: string; detail?: string; opIndex?: number }

const MAX_OPS = 32

function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** 解析 JSON Pointer；根路径 "" 或 "/" → 空 tokens */
export function parseJsonPointer(path: string): string[] | null {
  if (typeof path !== 'string') return null
  if (path === '' || path === '/') return []
  if (!path.startsWith('/')) return null
  return path
    .slice(1)
    .split('/')
    .map((t) => unescapePointerToken(t))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function parseOps(raw: unknown): TracePatchOp[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OPS) return null
  const out: TracePatchOp[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const op = (item as { op?: unknown }).op
    const path = (item as { path?: unknown }).path
    if (typeof path !== 'string' || !path.trim()) return null
    if (op === 'remove') {
      out.push({ op: 'remove', path: path.trim() })
      continue
    }
    if (op === 'replace' || op === 'add') {
      if (!('value' in (item as object))) return null
      out.push({
        op,
        path: path.trim(),
        value: (item as { value: unknown }).value,
      })
      continue
    }
    return null
  }
  return out
}

type ParentRef =
  | { kind: 'object'; parent: Record<string, unknown>; key: string }
  | { kind: 'array'; parent: unknown[]; key: number | '-' }

function resolveParent(
  root: Record<string, unknown>,
  tokens: string[],
): ParentRef | null {
  if (tokens.length === 0) return null
  let cur: unknown = root
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]!
    if (Array.isArray(cur)) {
      const idx = Number(t)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return null
      cur = cur[idx]
      continue
    }
    if (!isPlainObject(cur)) return null
    if (!(t in cur)) return null
    cur = cur[t]
  }
  const last = tokens[tokens.length - 1]!
  if (Array.isArray(cur)) {
    if (last === '-') return { kind: 'array', parent: cur, key: '-' }
    const idx = Number(last)
    if (!Number.isInteger(idx) || idx < 0 || idx > cur.length) return null
    return { kind: 'array', parent: cur, key: idx }
  }
  if (!isPlainObject(cur)) return null
  return { kind: 'object', parent: cur, key: last }
}

function pathExists(root: Record<string, unknown>, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  let cur: unknown = root
  for (const t of tokens) {
    if (Array.isArray(cur)) {
      const idx = Number(t)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return false
      cur = cur[idx]
      continue
    }
    if (!isPlainObject(cur) || !(t in cur)) return false
    cur = cur[t]
  }
  return true
}

function applyOne(
  root: Record<string, unknown>,
  op: TracePatchOp,
): { ok: true } | { ok: false; code: string; detail?: string } {
  const tokens = parseJsonPointer(op.path)
  if (!tokens) return { ok: false, code: 'invalid_path', detail: op.path }
  if (tokens.length === 0) {
    return { ok: false, code: 'root_path_forbidden', detail: op.path }
  }

  if (op.op === 'remove') {
    if (!pathExists(root, tokens)) {
      return { ok: false, code: 'path_not_found', detail: op.path }
    }
    const parent = resolveParent(root, tokens)
    if (!parent) return { ok: false, code: 'path_not_found', detail: op.path }
    if (parent.kind === 'object') {
      delete parent.parent[parent.key]
      return { ok: true }
    }
    if (parent.key === '-') {
      return { ok: false, code: 'invalid_path', detail: op.path }
    }
    parent.parent.splice(parent.key, 1)
    return { ok: true }
  }

  if (op.op === 'replace') {
    if (!pathExists(root, tokens)) {
      return { ok: false, code: 'path_not_found', detail: op.path }
    }
    const parent = resolveParent(root, tokens)
    if (!parent) return { ok: false, code: 'path_not_found', detail: op.path }
    if (parent.kind === 'object') {
      parent.parent[parent.key] = op.value
      return { ok: true }
    }
    if (parent.key === '-') {
      return { ok: false, code: 'invalid_path', detail: op.path }
    }
    if (parent.key >= parent.parent.length) {
      return { ok: false, code: 'path_not_found', detail: op.path }
    }
    parent.parent[parent.key] = op.value
    return { ok: true }
  }

  // add
  const parent = resolveParent(root, tokens)
  if (!parent) return { ok: false, code: 'parent_not_found', detail: op.path }
  if (parent.kind === 'object') {
    if (Object.prototype.hasOwnProperty.call(parent.parent, parent.key)) {
      return { ok: false, code: 'path_exists', detail: op.path }
    }
    parent.parent[parent.key] = op.value
    return { ok: true }
  }
  if (parent.key === '-') {
    parent.parent.push(op.value)
    return { ok: true }
  }
  if (parent.key > parent.parent.length) {
    return { ok: false, code: 'invalid_path', detail: op.path }
  }
  parent.parent.splice(parent.key, 0, op.value)
  return { ok: true }
}

export function applyTracePatchOps(
  base: Record<string, unknown>,
  opsRaw: unknown,
): ApplyTracePatchResult {
  if (!isPlainObject(base)) {
    return { ok: false, code: 'invalid_base' }
  }
  const ops = parseOps(opsRaw)
  if (!ops) return { ok: false, code: 'invalid_ops' }

  const next = cloneJson(base)
  for (let i = 0; i < ops.length; i++) {
    const r = applyOne(next, ops[i]!)
    if (!r.ok) {
      return {
        ok: false,
        code: r.code,
        detail: r.detail,
        opIndex: i,
      }
    }
  }
  return { ok: true, state: next, applied: ops.length }
}

export const TRACE_PATCH_MAX_OPS = MAX_OPS
