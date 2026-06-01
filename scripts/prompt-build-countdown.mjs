/**
 * 启动前倒计时；TTY 下按 R 触发重新 build。
 * @returns {Promise<boolean>} 是否应执行 build
 */
export async function runBuildCountdownPrompt(options = {}) {
  const seconds = Math.max(0, Number(options.seconds) ?? 5)

  if (seconds === 0 || !process.stdin.isTTY) {
    return false
  }

  return new Promise((resolve) => {
    let remaining = seconds
    let done = false
    let rebuild = false

    const finish = (wantRebuild) => {
      if (done) return
      done = true
      rebuild = wantRebuild
      cleanup()
      process.stdout.write('\n')
      resolve(rebuild)
    }

    const onData = (chunk) => {
      const key = String(chunk)
      if (key === 'r' || key === 'R') {
        finish(true)
        return
      }
      if (key === '\u0003') {
        cleanup()
        process.exit(130)
      }
    }

    const cleanup = () => {
      clearInterval(timer)
      if (process.stdin.isTTY) {
        process.stdin.removeListener('data', onData)
        process.stdin.setRawMode(false)
        process.stdin.pause()
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)

    const writeLine = () => {
      process.stdout.write(
        `\r[启动] ${remaining} 秒后启动（按 R 重新 build）…   `,
      )
    }

    writeLine()
    const timer = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        finish(false)
        return
      }
      writeLine()
    }, 1000)
  })
}
