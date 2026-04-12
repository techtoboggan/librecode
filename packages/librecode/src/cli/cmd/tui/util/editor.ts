import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliRenderer } from "@opentui/core"
import { defer } from "@/util/defer"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) return

  const filepath = join(tmpdir(), `${Date.now()}.md`)
  await using _ = defer(async () => rm(filepath, { force: true }))

  await Filesystem.write(filepath, opts.value)
  opts.renderer.suspend()
  opts.renderer.currentRenderBuffer.clear()
  const parts = editor.split(" ")
  const proc = Process.spawn([...parts, filepath], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  await proc.exited
  const content = await Filesystem.readText(filepath)
  opts.renderer.currentRenderBuffer.clear()
  opts.renderer.resume()
  opts.renderer.requestRender()
  return content || undefined
}

export const Editor = {
  open,
} as const
