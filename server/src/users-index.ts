import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword, verifyPassword } from './auth-password.js'
import {
  UserAccountError,
  UserAccountErrorCodes,
} from './user-account-error.js'
import {
  DATA_DIR,
  ensureDataSkeletonForUser,
  getUserAvatarPath,
  getUserDataDir,
  getUsersIndexPath,
} from './config.js'
import { seedDefaultPromptsForUser } from './prompts-default-seed.js'
import { seedDefaultApiSettingsForUser } from './api-settings-default-seed.js'
import { seedDefaultLorebooksForUser } from './lorebooks-default-seed.js'
import {
  allocateUserId,
  isValidShortId,
  RESERVED_USER_ID,
} from './short-id.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,31}$/

export interface UserIndexEntry {
  id: string
  username: string
  passwordHash: string
  displayName: string
  setupComplete: boolean
  createdAt: string
  updatedAt: string
}

export interface UsersIndexDocument {
  schemaVersion: 1
  users: UserIndexEntry[]
}

function defaultAvatarSourcePath(): string {
  return path.join(__dirname, '..', 'assets', 'users', 'default-avatar.png')
}

function seedDefaultAvatar(userId: string): void {
  const src = defaultAvatarSourcePath()
  const dest = getUserAvatarPath(userId)
  if (!existsSync(src)) return
  try {
    copyFileSync(src, dest)
  } catch {
    /* ignore */
  }
}

function emptyIndex(): UsersIndexDocument {
  const t = new Date().toISOString()
  return {
    schemaVersion: 1,
    users: [
      {
        id: RESERVED_USER_ID,
        username: '',
        passwordHash: '',
        displayName: '',
        setupComplete: false,
        createdAt: t,
        updatedAt: t,
      },
    ],
  }
}

export async function readUsersIndex(): Promise<UsersIndexDocument> {
  const p = getUsersIndexPath()
  if (!existsSync(p)) {
    return emptyIndex()
  }
  const raw = await readFile(p, 'utf8')
  const parsed = JSON.parse(raw) as Partial<UsersIndexDocument>
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.users)) {
    throw new Error('users.index.json 格式无效')
  }
  return parsed as UsersIndexDocument
}

export async function writeUsersIndex(doc: UsersIndexDocument): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  const target = getUsersIndexPath()
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await rename(tmp, target)
}

export function validateUsername(username: string): string {
  const u = username.trim()
  if (!USERNAME_RE.test(u)) {
    throw new Error(
      '用户名须为 2–32 位字母、数字、下划线或连字符，且以字母或数字开头',
    )
  }
  return u
}

export function findUserById(
  doc: UsersIndexDocument,
  id: string,
): UserIndexEntry | undefined {
  return doc.users.find((u) => u.id === id)
}

export function findUserByUsername(
  doc: UsersIndexDocument,
  username: string,
): UserIndexEntry | undefined {
  const u = username.trim().toLowerCase()
  return doc.users.find((x) => x.username.toLowerCase() === u)
}

export function publicUser(u: UserIndexEntry) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    setupComplete: u.setupComplete,
    avatarUrl: `/api/users/${u.id}/avatar`,
  }
}

/** 首次启动：写入 users.index + 种子目录 00000000 */
export async function ensureUsersRegistry(): Promise<UsersIndexDocument> {
  const indexPath = getUsersIndexPath()
  let doc: UsersIndexDocument
  if (!existsSync(indexPath)) {
    doc = emptyIndex()
    await writeUsersIndex(doc)
    ensureDataSkeletonForUser(RESERVED_USER_ID)
    seedDefaultAvatar(RESERVED_USER_ID)
    await seedDefaultPromptsForUser(RESERVED_USER_ID)
    await seedDefaultApiSettingsForUser(RESERVED_USER_ID)
    await seedDefaultLorebooksForUser(RESERVED_USER_ID)
    return doc
  }
  doc = await readUsersIndex()
  const seed = findUserById(doc, RESERVED_USER_ID)
  if (!seed) {
    const t = new Date().toISOString()
    doc.users.unshift({
      id: RESERVED_USER_ID,
      username: '',
      passwordHash: '',
      displayName: '',
      setupComplete: false,
      createdAt: t,
      updatedAt: t,
    })
    await writeUsersIndex(doc)
  }
  ensureDataSkeletonForUser(RESERVED_USER_ID)
  if (!existsSync(getUserAvatarPath(RESERVED_USER_ID))) {
    seedDefaultAvatar(RESERVED_USER_ID)
  }
  await seedDefaultPromptsForUser(RESERVED_USER_ID)
  await seedDefaultApiSettingsForUser(RESERVED_USER_ID)
  await seedDefaultLorebooksForUser(RESERVED_USER_ID)
  return doc
}

export async function completeSeedUserSetup(body: {
  username: string
  password: string
  displayName?: string
}): Promise<UserIndexEntry> {
  const doc = await readUsersIndex()
  const seed = findUserById(doc, RESERVED_USER_ID)
  if (!seed) throw new Error('种子用户不存在')
  if (seed.setupComplete) throw new Error('初始设置已完成')

  const username = validateUsername(body.username)
  if (findUserByUsername(doc, username)) {
    throw new Error('用户名已被占用')
  }
  if (!body.password || body.password.length < 6) {
    throw new Error('密码至少 6 位')
  }

  const t = new Date().toISOString()
  seed.username = username
  seed.displayName =
    typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim()
      : username
  seed.passwordHash = await hashPassword(body.password)
  seed.setupComplete = true
  seed.updatedAt = t
  await writeUsersIndex(doc)
  return seed
}

export async function registerUser(body: {
  username: string
  password: string
  displayName?: string
}): Promise<UserIndexEntry> {
  const doc = await readUsersIndex()
  const username = validateUsername(body.username)
  if (findUserByUsername(doc, username)) {
    throw new Error('用户名已被占用')
  }
  if (!body.password || body.password.length < 6) {
    throw new Error('密码至少 6 位')
  }

  const used = new Set(doc.users.map((u) => u.id))
  const id = allocateUserId(used)
  const t = new Date().toISOString()
  const entry: UserIndexEntry = {
    id,
    username,
    passwordHash: await hashPassword(body.password),
    displayName:
      typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : username,
    setupComplete: true,
    createdAt: t,
    updatedAt: t,
  }
  doc.users.push(entry)
  await writeUsersIndex(doc)
  ensureDataSkeletonForUser(id)
  seedDefaultAvatar(id)
  await seedDefaultPromptsForUser(id)
  await seedDefaultApiSettingsForUser(id)
  await seedDefaultLorebooksForUser(id)
  return entry
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<UserIndexEntry | null> {
  const doc = await readUsersIndex()
  const user = findUserByUsername(doc, username)
  if (!user || !user.setupComplete) return null
  const ok = await verifyPassword(password, user.passwordHash)
  return ok ? user : null
}

export async function updateUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!newPassword || newPassword.length < 6) {
    throw new UserAccountError(UserAccountErrorCodes.PASSWORD_TOO_SHORT)
  }
  const doc = await readUsersIndex()
  const user = findUserById(doc, userId)
  if (!user) throw new UserAccountError(UserAccountErrorCodes.USER_NOT_FOUND)
  const ok = await verifyPassword(currentPassword, user.passwordHash)
  if (!ok) throw new UserAccountError(UserAccountErrorCodes.WRONG_CURRENT_PASSWORD)
  user.passwordHash = await hashPassword(newPassword)
  user.updatedAt = new Date().toISOString()
  await writeUsersIndex(doc)
}

/** 运维台删除用户（无需确认用户名；不可删种子账号） */
export async function deleteUserByAdmin(targetUserId: string): Promise<void> {
  if (targetUserId === RESERVED_USER_ID) {
    throw new UserAccountError(UserAccountErrorCodes.CANNOT_DELETE_SEED_ONLY)
  }
  const doc = await readUsersIndex()
  const user = findUserById(doc, targetUserId)
  if (!user) throw new UserAccountError(UserAccountErrorCodes.USER_NOT_FOUND)

  doc.users = doc.users.filter((u) => u.id !== targetUserId)
  await writeUsersIndex(doc)

  const dir = getUserDataDir(targetUserId)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function adminResetUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  if (!newPassword || newPassword.length < 6) {
    throw new UserAccountError(UserAccountErrorCodes.PASSWORD_TOO_SHORT)
  }
  const doc = await readUsersIndex()
  const user = findUserById(doc, userId)
  if (!user) throw new UserAccountError(UserAccountErrorCodes.USER_NOT_FOUND)
  user.passwordHash = await hashPassword(newPassword)
  user.updatedAt = new Date().toISOString()
  await writeUsersIndex(doc)
}

export async function deleteUserAccount(
  userId: string,
  confirmUsername: string,
): Promise<void> {
  const doc = await readUsersIndex()
  const user = findUserById(doc, userId)
  if (!user) throw new UserAccountError(UserAccountErrorCodes.USER_NOT_FOUND)
  if (user.username !== confirmUsername.trim()) {
    throw new UserAccountError(UserAccountErrorCodes.USERNAME_MISMATCH)
  }
  if (user.id === RESERVED_USER_ID && doc.users.length === 1) {
    throw new UserAccountError(UserAccountErrorCodes.CANNOT_DELETE_SEED_ONLY)
  }

  doc.users = doc.users.filter((u) => u.id !== userId)
  await writeUsersIndex(doc)

  const dir = getUserDataDir(userId)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function dirSizeBytes(root: string): Promise<number> {
  let total = 0
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const ent of entries) {
    const p = path.join(root, ent.name)
    if (ent.isDirectory()) {
      total += await dirSizeBytes(p)
    } else if (ent.isFile()) {
      const s = await stat(p)
      total += s.size
    }
  }
  return total
}

export async function getUserStorageStats(userId: string): Promise<{
  userId: string
  dataDir: string
  bytes: number
  conversationCount: number
}> {
  if (!isValidShortId(userId)) throw new Error('无效的用户 id')
  const dataDir = getUserDataDir(userId)
  const bytes = existsSync(dataDir) ? await dirSizeBytes(dataDir) : 0
  let conversationCount = 0
  const chatsRoot = path.join(dataDir, 'chats')
  if (existsSync(chatsRoot)) {
    const names = await readdir(chatsRoot)
    conversationCount = names.filter((n) => isValidShortId(n)).length
  }
  return { userId, dataDir, bytes, conversationCount }
}
