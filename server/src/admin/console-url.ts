import { resolveServerPort } from '../config.js'

/** 运维台入口（固定 loopback + 后端端口，见 DOC/17 §2.4） */
export function buildAdminConsoleUrl(): string {
  return `http://127.0.0.1:${resolveServerPort()}/admin`
}
