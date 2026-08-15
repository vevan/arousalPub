/** Hybrid FTS 词典未就绪（写盘前 prepare 失败） */
export function isHybridFtsDictNotReadyError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith('dict not downloaded:')
  )
}
