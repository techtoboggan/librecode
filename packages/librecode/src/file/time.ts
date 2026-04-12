import { Flag } from "../flag/flag"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"

const fileTimeLog = Log.create({ service: "file.time" })

// Per-session read times plus per-file write locks.
// All tools that overwrite existing files should run their
// assert/read/write/update sequence inside withLock(filepath, ...)
// so concurrent writes to the same file are serialized.
const fileTimeState = Instance.state(() => {
  const read: {
    [sessionID: string]: {
      [path: string]: Date | undefined
    }
  } = {}
  const locks = new Map<string, Promise<void>>()
  return {
    read,
    locks,
  }
})

function fileTimeRead(sessionID: string, file: string) {
  fileTimeLog.info("read", { sessionID, file })
  const { read } = fileTimeState()
  read[sessionID] = read[sessionID] || {}
  read[sessionID][file] = new Date()
}

function fileTimeGet(sessionID: string, file: string) {
  return fileTimeState().read[sessionID]?.[file]
}

async function fileTimeWithLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
  const current = fileTimeState()
  const currentLock = current.locks.get(filepath) ?? Promise.resolve()
  let release: () => void = () => {}
  const nextLock = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = currentLock.then(() => nextLock)
  current.locks.set(filepath, chained)
  await currentLock
  try {
    return await fn()
  } finally {
    release()
    if (current.locks.get(filepath) === chained) {
      current.locks.delete(filepath)
    }
  }
}

async function fileTimeAssert(sessionID: string, filepath: string) {
  if (Flag.LIBRECODE_DISABLE_FILETIME_CHECK === true) {
    return
  }

  const time = fileTimeGet(sessionID, filepath)
  if (!time) throw new Error(`You must read file ${filepath} before overwriting it. Use the Read tool first`)
  const mtime = Filesystem.stat(filepath)?.mtime
  // Allow a 50ms tolerance for Windows NTFS timestamp fuzziness / async flushing
  if (mtime && mtime.getTime() > time.getTime() + 50) {
    throw new Error(
      `File ${filepath} has been modified since it was last read.\nLast modification: ${mtime.toISOString()}\nLast read: ${time.toISOString()}\n\nPlease read the file again before modifying it.`,
    )
  }
}

export const FileTime = {
  state: fileTimeState,
  read: fileTimeRead,
  get: fileTimeGet,
  withLock: fileTimeWithLock,
  assert: fileTimeAssert,
} as const
