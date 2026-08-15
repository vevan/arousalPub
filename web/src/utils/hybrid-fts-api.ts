import { useAuthStore } from '@/stores/auth'
import { readJsonSseStream } from '@/utils/json-sse'
import type { HybridFtsDictVariant, HybridFtsProfile } from '@/utils/hybrid-fts-settings'

export interface DictVariantCatalogEntry {
  id: HybridFtsDictVariant
  sourcePath: string
  downloadUrl: string
  sizeMbApprox: number
  artifactKind?: 'file' | 'zip'
  languageHint?: 'ja' | 'ko' | 'zh'
  tags?: readonly string[]
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
  modelHome: string
  sourcePath: string
  downloadUrl: string
  sizeMbApprox: number
  artifactKind?: 'file' | 'zip'
  languageHint?: 'ja' | 'ko' | 'zh'
  tags?: readonly string[]
}

export interface ProfileDictStatus {
  profile: HybridFtsProfile
  requiresDict: boolean
  repoUrl: string | null
  variants: DictVariantStatus[]
}

export type HybridFtsDictDownloadSseEvent =
  | { type: 'start'; totalBytes: number | null; variant: string }
  | {
      type: 'progress'
      receivedBytes: number
      totalBytes: number | null
      phase?: 'download' | 'extract'
    }
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
  let errorMessage: string | null = null
  let done = false
  await readJsonSseStream<HybridFtsDictDownloadSseEvent>(res.body, (ev) => {
    onEvent(ev)
    if (ev.type === 'error') {
      errorMessage = ev.detail ? `${ev.error}: ${ev.detail}` : ev.error
    }
    if (ev.type === 'done') done = true
  })
  if (errorMessage) throw new Error(errorMessage)
  if (!done) throw new Error('dict_download_incomplete')
}

export type HybridFtsDictImportResult = {
  ok: true
  profile: 'lindera'
  variant: HybridFtsDictVariant
  downloaded: boolean
}

/**
 * 上传官方 Lindera ZIP；onProgress 的 total 为浏览器 File.size。
 */
export function importHybridFtsDictZip(
  profile: HybridFtsProfile,
  file: File,
  onProgress?: (receivedBytes: number, totalBytes: number) => void,
): Promise<HybridFtsDictImportResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const url =
      `/api/hybrid-fts/dict-import` +
      `?profile=${encodeURIComponent(profile)}`
    xhr.open('POST', url)
    xhr.responseType = 'json'
    // XHR 不经过 installAuthenticatedFetch 的补丁，须自带 Bearer；
    // 否则鉴权 hook 会在读 body 前 401 并断开，大包上传只表现为网络错误
    const authToken = useAuthStore().token
    if (authToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${authToken}`)
    }
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return
      onProgress?.(ev.loaded, ev.total)
    }
    xhr.onload = () => {
      const body = xhr.response as
        | HybridFtsDictImportResult
        | { error?: string; detail?: string }
        | null
      if (xhr.status >= 200 && xhr.status < 300 && body && 'ok' in body && body.ok) {
        resolve(body)
        return
      }
      const err =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.detail
            ? `${body.error}: ${body.detail}`
            : body.error
          : `dict_import_failed (${xhr.status})`
      reject(new Error(err))
    }
    xhr.onerror = () => reject(new Error('dict_import_network_error'))
    xhr.onabort = () => reject(new Error('dict_import_aborted'))
    const form = new FormData()
    form.append('file', file, file.name || 'lindera-dictionary.zip')
    xhr.send(form)
  })
}
