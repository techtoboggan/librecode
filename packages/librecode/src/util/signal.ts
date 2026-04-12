export function signal() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((r) => (resolve = r))
  return {
    trigger() {
      return resolve?.()
    },
    wait() {
      return promise
    },
  }
}
