/**
 * Vector lore 召回后：用条目 keys 对 hybrid 分做低权重加分，再截断 TopK。
 * 宿主 generic：任意 lore entry.keys + query 文本，不绑定具体插件。
 */

/** 相对加分上限：final = base * (1 + MAX * hitRatio)；满额时最多 +12% */
export const VECTOR_KEYS_SCORE_BOOST_MAX = 0.12

/** hybrid 多召回倍数，供 keys 精排后再截断 */
export const VECTOR_KEYS_RERANK_CANDIDATE_FACTOR = 3

/** 精排命中忽略过短 key，降低单字误加分（入库附录仍保留原 keys） */
export const VECTOR_KEYS_MIN_HIT_LENGTH = 2

/**
 * hitRatio 分母上限：min(totalKeys, 本值)。
 * 摘要类条目常有 15–30 个 keys；若用 hits/total，单次命中加分可忽略不计。
 */
export const VECTOR_KEYS_HITS_FOR_FULL_BOOST = 3

export function normalizeLoreEntryKeys(keys: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of keys) {
    const k = typeof raw === 'string' ? raw.trim() : ''
    if (!k) continue
    const lower = k.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(k)
  }
  return out
}

/** 入库语料低权重附录（出现一次；空则返回 ''） */
export function lorebookEntryKeysCorpusAppendix(
  keys: readonly string[],
): string {
  const cleaned = normalizeLoreEntryKeys(keys)
  if (!cleaned.length) return ''
  return `Keywords: ${cleaned.join(', ')}`
}

export function countLoreKeyHitsInScan(
  keys: readonly string[],
  scanLower: string,
): { hits: number; total: number } {
  const cleaned = normalizeLoreEntryKeys(keys).filter(
    (k) => k.length >= VECTOR_KEYS_MIN_HIT_LENGTH,
  )
  if (!cleaned.length || !scanLower) {
    return { hits: 0, total: cleaned.length }
  }
  let hits = 0
  for (const key of cleaned) {
    if (scanLower.includes(key.toLowerCase())) hits += 1
  }
  return { hits, total: cleaned.length }
}

/**
 * hitRatio = hits / min(total, HITS_FOR_FULL_BOOST)，封顶 1。
 * 无 key 或无命中时返回 baseScore。
 */
export function applyVectorKeyScoreBoost(
  baseScore: number,
  keys: readonly string[],
  scanLower: string,
  boostMax = VECTOR_KEYS_SCORE_BOOST_MAX,
): number {
  if (!Number.isFinite(baseScore)) return baseScore
  const { hits, total } = countLoreKeyHitsInScan(keys, scanLower)
  if (hits <= 0 || total <= 0) return baseScore
  const denom = Math.min(total, VECTOR_KEYS_HITS_FOR_FULL_BOOST)
  const ratio = Math.min(1, hits / denom)
  const cap = Math.max(0, boostMax)
  return baseScore * (1 + cap * ratio)
}

export function vectorRerankCandidateLimit(
  topK: number,
  factor = VECTOR_KEYS_RERANK_CANDIDATE_FACTOR,
): number {
  const k = Math.max(1, Math.floor(topK))
  const f = Math.max(1, Math.floor(factor))
  return Math.min(64, Math.max(k * f, k))
}

export type VectorKeyRerankCandidate = {
  id: string
  keys: readonly string[]
  baseScore: number
  /** 同分时越大越优先；默认 0 */
  priority?: number
}

/**
 * keys 加分 → 按 score / priority 排序 → 截断 TopK（去重 id）。
 * `collectVectorMatches` 与单测共用，保证精排语义一致。
 */
export function selectTopAfterVectorKeyBoost(
  candidates: readonly VectorKeyRerankCandidate[],
  scanLower: string,
  topK: number,
): Array<{ id: string; score: number }> {
  const limit = Math.max(1, Math.floor(topK))
  const ranked = candidates.map((c) => ({
    id: c.id,
    priority: c.priority ?? 0,
    score: applyVectorKeyScoreBoost(c.baseScore, c.keys, scanLower),
  }))
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.priority - a.priority
  })
  const out: Array<{ id: string; score: number }> = []
  const taken = new Set<string>()
  for (const r of ranked) {
    if (out.length >= limit) break
    if (taken.has(r.id)) continue
    taken.add(r.id)
    out.push({ id: r.id, score: r.score })
  }
  return out
}
