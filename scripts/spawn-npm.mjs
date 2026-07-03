/**
 * 启动 npm 子进程（避免 DEP0190：shell:true 时勿与 args 数组同用 spawn）。
 */
import { spawn, spawnSync } from 'node:child_process'

export function npmShellCommand(args) {
  return `npm ${args.join(' ')}`
}

export function spawnNpm(args, options) {
  return spawn(npmShellCommand(args), { ...options, shell: true })
}

export function spawnSyncNpm(args, options) {
  return spawnSync(npmShellCommand(args), { ...options, shell: true })
}
