import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface BuildInfoDocument {
  version: string | null
  gitCommit: string | null
  gitCommitDate: string | null
  builtAt: string | null
}

const EMPTY_BUILD_INFO: BuildInfoDocument = {
  version: null,
  gitCommit: null,
  gitCommitDate: null,
  builtAt: null,
}

function resolveBuildMetaPath(): string | null {
  const besideEntry = path.join(__dirname, 'build-meta.json')
  if (existsSync(besideEntry)) return besideEntry
  const fromSrcDev = path.join(__dirname, '..', 'dist', 'build-meta.json')
  if (existsSync(fromSrcDev)) return fromSrcDev
  return null
}

export function readBuildInfoDocument(): BuildInfoDocument {
  const metaPath = resolveBuildMetaPath()
  if (!metaPath) return { ...EMPTY_BUILD_INFO }

  try {
    const doc = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>
    const gitCommit =
      typeof doc.gitCommit === 'string' && doc.gitCommit.trim()
        ? doc.gitCommit.trim()
        : null
    const gitCommitDate =
      typeof doc.gitCommitDate === 'string' && doc.gitCommitDate.trim()
        ? doc.gitCommitDate.trim()
        : null
    const version =
      typeof doc.version === 'string' && doc.version.trim()
        ? doc.version.trim()
        : gitCommitDate
    const builtAt =
      typeof doc.builtAt === 'string' && doc.builtAt.trim()
        ? doc.builtAt.trim()
        : null
    return { version, gitCommit, gitCommitDate, builtAt }
  } catch {
    return { ...EMPTY_BUILD_INFO }
  }
}
