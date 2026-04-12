const locks = new Map<
  string,
  {
    readers: number
    writer: boolean
    waitingReaders: (() => void)[]
    waitingWriters: (() => void)[]
  }
>()

function lockGet(key: string) {
  if (!locks.has(key)) {
    locks.set(key, {
      readers: 0,
      writer: false,
      waitingReaders: [],
      waitingWriters: [],
    })
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const entry = locks.get(key)
  if (!entry) throw new Error(`Lock entry missing for key: ${key}`)
  return entry
}

function lockProcess(key: string) {
  const lock = locks.get(key)
  if (!lock || lock.writer || lock.readers > 0) return

  // Prioritize writers to prevent starvation
  if (lock.waitingWriters.length > 0) {
    const nextWriter = lock.waitingWriters.shift()
    if (nextWriter) nextWriter()
    return
  }

  // Wake up all waiting readers
  while (lock.waitingReaders.length > 0) {
    const nextReader = lock.waitingReaders.shift()
    if (nextReader) nextReader()
  }

  // Clean up empty locks
  if (lock.readers === 0 && !lock.writer && lock.waitingReaders.length === 0 && lock.waitingWriters.length === 0) {
    locks.delete(key)
  }
}

async function lockRead(key: string): Promise<Disposable> {
  const lock = lockGet(key)

  return new Promise((resolve) => {
    if (!lock.writer && lock.waitingWriters.length === 0) {
      lock.readers++
      resolve({
        [Symbol.dispose]: () => {
          lock.readers--
          lockProcess(key)
        },
      })
    } else {
      lock.waitingReaders.push(() => {
        lock.readers++
        resolve({
          [Symbol.dispose]: () => {
            lock.readers--
            lockProcess(key)
          },
        })
      })
    }
  })
}

async function lockWrite(key: string): Promise<Disposable> {
  const lock = lockGet(key)

  return new Promise((resolve) => {
    if (!lock.writer && lock.readers === 0) {
      lock.writer = true
      resolve({
        [Symbol.dispose]: () => {
          lock.writer = false
          lockProcess(key)
        },
      })
    } else {
      lock.waitingWriters.push(() => {
        lock.writer = true
        resolve({
          [Symbol.dispose]: () => {
            lock.writer = false
            lockProcess(key)
          },
        })
      })
    }
  })
}

export const Lock = {
  read: lockRead,
  write: lockWrite,
} as const
