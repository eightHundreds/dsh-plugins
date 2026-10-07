export function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  return new Error('LSP query aborted')
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal)
}

export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return work
  if (signal.aborted) return Promise.reject(abortError(signal))
  let onAbort: () => void
  const canceled = new Promise<never>((_, reject) => {
    onAbort = () => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  const normalized = work.catch((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error))
  })
  return Promise.race([normalized, canceled])
    .finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
}
