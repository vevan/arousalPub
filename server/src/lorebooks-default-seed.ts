import { existsSync } from 'node:fs'
import { getLorebooksIndexPath } from './config.js'
import { buildDefaultLorebook, writeLorebooksDocument } from './lorebook-file.js'
import { runRequestUser } from './user-context.js'

/** 新用户目录：无 lorebooks/index.json 时写入默认世界书 */
export async function seedDefaultLorebooksForUser(
  userId: string,
): Promise<boolean> {
  if (existsSync(getLorebooksIndexPath(userId))) return false
  const lb = buildDefaultLorebook()
  const savedAt = new Date().toISOString()
  await runRequestUser(userId, () =>
    writeLorebooksDocument({
      schemaVersion: 1,
      savedAt,
      lorebooks: [lb],
    }),
  )
  return true
}
