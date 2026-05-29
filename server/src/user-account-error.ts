/** 账号 API 可本地化错误码（前端 settings.accountApiErrors.*） */
export const UserAccountErrorCodes = {
  USER_NOT_FOUND: 'user_not_found',
  USERNAME_MISMATCH: 'username_mismatch',
  CANNOT_DELETE_SEED_ONLY: 'cannot_delete_seed_only',
  WRONG_CURRENT_PASSWORD: 'wrong_current_password',
  PASSWORD_TOO_SHORT: 'password_too_short',
} as const

export type UserAccountErrorCode =
  (typeof UserAccountErrorCodes)[keyof typeof UserAccountErrorCodes]

export class UserAccountError extends Error {
  readonly code: UserAccountErrorCode

  constructor(code: UserAccountErrorCode) {
    super(code)
    this.name = 'UserAccountError'
    this.code = code
  }
}
