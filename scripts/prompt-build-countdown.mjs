/**
 * Pre-start countdown; on TTY: B=rebuild, Space=skip countdown.
 * @returns {Promise<boolean>} whether to run build
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
      if (key === 'b' || key === 'B') {
        finish(true)
        return
      }
      if (key === ' ' || key === '\u0020') {
        finish(false)
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
        `\r[start] Starting in ${remaining}s (B=rebuild, Space=skip)…   `,
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
