export let summarizeRunning = false
export let memorybookEnabledCache = false

type ReviewDraft = { title: string; content: string; keywords: string[] }

let _reviewResolver: {
  resolve: (v: ReviewDraft) => void
  reject: (e: Error) => void
} | null = null

let _reviewRegenerate: ((host: object) => Promise<ReviewDraft>) | null = null

let _lorebookPickResolver: {
  resolve: (v: string) => void
  reject: (e: Error) => void
} | null = null

export let summarizeBatchProgress: { taskIndex: number; total: number } | null = null

export function setSummarizeRunning(v: boolean) {
  summarizeRunning = v
}

export function setMemorybookEnabledCache(v: boolean) {
  memorybookEnabledCache = v
}

export function setSummarizeBatchProgress(
  v: { taskIndex: number; total: number } | null,
) {
  summarizeBatchProgress = v
}

export function getReviewResolver() {
  return _reviewResolver
}

export function setReviewResolver(v: typeof _reviewResolver) {
  _reviewResolver = v
}

export function getReviewRegenerate() {
  return _reviewRegenerate
}

export function setReviewRegenerate(v: typeof _reviewRegenerate) {
  _reviewRegenerate = v
}

export function clearReviewSession() {
  _reviewResolver = null
  _reviewRegenerate = null
}

export function getLorebookPickResolver() {
  return _lorebookPickResolver
}

export function setLorebookPickResolver(v: typeof _lorebookPickResolver) {
  _lorebookPickResolver = v
}

export function clearLorebookPickResolver() {
  _lorebookPickResolver = null
}
