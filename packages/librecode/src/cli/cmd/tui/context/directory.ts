import { createMemo } from "solid-js"
import { Global } from "@/global"
import { useSync } from "./sync"

export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory || process.cwd()
    const result = directory.replace(Global.Path.home, "~")
    if (sync.data.vcs?.branch) return `${result}:${sync.data.vcs.branch}`
    return result
  })
}
