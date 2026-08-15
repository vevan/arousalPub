import path from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'

export interface LorebookVectorProfileDocument {
  schemaVersion: 1
  lorebookId: string
  embeddingProfile: string
  embeddingModel: string
  embeddingDimensions: number | null
  hybridFtsSpec: string
  updatedAt: string
}

function profilePath(lorebookId: string): string {
  return path.join(
    getUserDataDir(getCurrentUserId()),
    'memory',
    'lorebooks',
    lorebookId,
    'embedding-profile.json',
  )
}

export async function readLorebookVectorProfile(
  lorebookId: string,
): Promise<LorebookVectorProfileDocument | null> {
  try {
    const parsed = JSON.parse(await readFile(profilePath(lorebookId), 'utf8')) as
      Partial<LorebookVectorProfileDocument>
    if (
      parsed.schemaVersion !== 1 ||
      parsed.lorebookId !== lorebookId ||
      typeof parsed.embeddingProfile !== 'string' ||
      typeof parsed.embeddingModel !== 'string' ||
      typeof parsed.hybridFtsSpec !== 'string'
    ) {
      return null
    }
    return parsed as LorebookVectorProfileDocument
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return null
  }
}

/** 索引被删除时一并清戳记，避免残留旧 spec 被当成「已建索引且过期」 */
export async function deleteLorebookVectorProfile(
  lorebookId: string,
): Promise<void> {
  await rm(profilePath(lorebookId), { force: true })
}

export async function writeLorebookVectorProfile(
  document: LorebookVectorProfileDocument,
): Promise<void> {
  const target = profilePath(document.lorebookId)
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(document, null, 2), 'utf8')
  await rename(temporary, target)
}
