/**
 * Vector lore 召回后：用条目 keys 对 hybrid 分做低权重加分，再截断 TopK。
 * 宿主 generic：任意 lore entry.keys + query 文本，不绑定具体插件。
 */

/** 相对加分上限：final = base * (1 + MAX * hitRatio)；命中全部 key 时最多 +12% */
export const VECTOR_KEYS_SCORE_BOOST_MAX = 0.12

/** hybrid 多召回倍数，供 keys 精排后再截断 */
export const VECTOR_KEYS_RERANK_CANDIDATE_FACTOR = 3

/** 精排命中忽略过短 key，降低单字误加分（入库附录仍保留原 keys） */
export const VECTOR_KEYS_MIN_HIT_LENGTH = 2

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

/** hitRatio = hits/total；无 key 或无命中时返回 baseScore */
export function applyVectorKeyScoreBoost(
  baseScore: number,
  keys: readonly string[],
  scanLower: string,
  boostMax = VECTOR_KEYS_SCORE_BOOST_MAX,
): number {
  if (!Number.isFinite(baseScore)) return baseScore
  const { hits, total } = countLoreKeyHitsInScan(keys, scanLower)
  if (hits <= 0 || total <= 0) return baseScore
  const ratio = hits / total
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
