import { readJsonSseStream } from '@/utils/json-sse'
import type { HybridFtsDictVariant, HybridFtsProfile } from '@/utils/hybrid-fts-settings'

export interface DictVariantCatalogEntry {
  id: HybridFtsDictVariant
  sourcePath: string
  downloadUrl: string
  sizeMbApprox: number
}

export interface TokenizerCatalogEntry {
  profile: HybridFtsProfile
  requiresDict: boolean
  dictFamily: string | null
  repoUrl: string | null
  variants: DictVariantCatalogEntry[]
}

export interface DictVariantStatus {
  id: HybridFtsDictVariant
  downloaded: boolean
  storagePath: string
  sourcePath: string
  downloadUrl: string
  sizeMbApprox: number
}

export interface ProfileDictStatus {
  profile: HybridFtsProfile
  requiresDict: boolean
  repoUrl: string | null
  activeDictPath: string
  variants: DictVariantStatus[]
}

export type HybridFtsDictDownloadSseEvent =
  | { type: 'start'; totalBytes: number | null; variant: string }
  | { type: 'progress'; receivedBytes: number; totalBytes: number | null }
  | { type: 'done'; ok: true; variant: string }
  | { type: 'error'; ok: false; error: string; detail?: string }

export async function fetchHybridFtsCatalog(): Promise<TokenizerCatalogEntry[]> {
  const res = await fetch('/api/hybrid-fts/catalog')
  if (!res.ok) throw new Error(await res.text())
  const j = (await res.json()) as { catalog?: TokenizerCatalogEntry[] }
  return j.catalog ?? []
}

export async function fetchProfileDictStatus(
  profile: HybridFtsProfile,
): Promise<ProfileDictStatus> {
  const res = await fetch(
    `/api/hybrid-fts/dict-status?profile=${encodeURIComponent(profile)}`,
  )
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as ProfileDictStatus
}

export async function downloadHybridFtsDict(
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
  onEvent: (ev: HybridFtsDictDownloadSseEvent) => void,
): Promise<void> {
  const res = await fetch('/api/hybrid-fts/dict-download?stream=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, variant }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(txt.slice(0, 300))
  }
  let failed: HybridFtsDictDownloadSseEvent | null = null
  let done = false
  await readJsonSseStream<HybridFtsDictDownloadSseEvent>(res.body, (ev) => {
    onEvent(ev)
    if (ev.type === 'error') failed = ev
    if (ev.type === 'done') done = true
  })
  if (failed) {
    const detail = failed.type === 'error' && failed.detail ? `: ${failed.detail}` : ''
    throw new Error(`${failed.type === 'error' ? failed.error : 'download_failed'}${detail}`)
  }
  if (!done) throw new Error('dict_download_incomplete')
}
