import { platform, release } from "os"
import clipboardy from "clipboardy"
import { lazy } from "../../../../util/lazy.js"
import { tmpdir } from "os"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../../../../util/filesystem"
import { Process } from "../../../../util/process"
import { which } from "../../../../util/which"

/**
 * Writes text to clipboard via OSC 52 escape sequence.
 * This allows clipboard operations to work over SSH by having
 * the terminal emulator handle the clipboard locally.
 */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return
  const base64 = Buffer.from(text).toString("base64")
  const osc52 = `\x1b]52;c;${base64}\x07`
  const passthrough = process.env["TMUX"] || process.env["STY"]
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
  process.stdout.write(sequence)
}

export namespace Clipboard {
  export interface Content {
    data: string
    mime: string
  }

  async function readDarwinImage(): Promise<Content | undefined> {
    const tmpfile = path.join(tmpdir(), "librecode-clipboard.png")
    try {
      await Process.run(
        [
          "osascript",
          "-e",
          'set imageData to the clipboard as "PNGf"',
          "-e",
          `set fileRef to open for access POSIX file "${tmpfile}" with write permission`,
          "-e",
          "set eof fileRef to 0",
          "-e",
          "write imageData to fileRef",
          "-e",
          "close access fileRef",
        ],
        { nothrow: true },
      )
      const buffer = await Filesystem.readBytes(tmpfile)
      return { data: buffer.toString("base64"), mime: "image/png" }
    } catch {
      return undefined
    } finally {
      await fs.rm(tmpfile, { force: true }).catch(() => {})
    }
  }

  async function readWin32Image(): Promise<Content | undefined> {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }"
    const base64 = await Process.text(["powershell.exe", "-NonInteractive", "-NoProfile", "-command", script], {
      nothrow: true,
    })
    if (!base64.text) return undefined
    const imageBuffer = Buffer.from(base64.text.trim(), "base64")
    if (imageBuffer.length === 0) return undefined
    return { data: imageBuffer.toString("base64"), mime: "image/png" }
  }

  async function readLinuxImage(): Promise<Content | undefined> {
    const wayland = await Process.run(["wl-paste", "-t", "image/png"], { nothrow: true })
    if (wayland.stdout.byteLength > 0) {
      return { data: Buffer.from(wayland.stdout).toString("base64"), mime: "image/png" }
    }
    const x11 = await Process.run(["xclip", "-selection", "clipboard", "-t", "image/png", "-o"], { nothrow: true })
    if (x11.stdout.byteLength > 0) {
      return { data: Buffer.from(x11.stdout).toString("base64"), mime: "image/png" }
    }
    return undefined
  }

  export async function read(): Promise<Content | undefined> {
    const os = platform()

    if (os === "darwin") {
      const result = await readDarwinImage()
      if (result) return result
    }

    if (os === "win32" || release().includes("WSL")) {
      const result = await readWin32Image()
      if (result) return result
    }

    if (os === "linux") {
      const result = await readLinuxImage()
      if (result) return result
    }

    const text = await clipboardy.read().catch(() => {})
    if (text) return { data: text, mime: "text/plain" }
  }

  function makeOsascriptCopier(): ((text: string) => Promise<void>) | null {
    if (platform() !== "darwin" || !which("osascript")) return null
    console.log("clipboard: using osascript")
    return async (text: string) => {
      const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      await Process.run(["osascript", "-e", `set the clipboard to "${escaped}"`], { nothrow: true })
    }
  }

  async function pipeToProc(cmd: string[], args: string[], text: string): Promise<void> {
    const proc = Process.spawn([cmd[0], ...cmd.slice(1), ...args], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
    if (!proc.stdin) return
    proc.stdin.write(text)
    proc.stdin.end()
    await proc.exited.catch(() => {})
  }

  function makeLinuxCopier(): ((text: string) => Promise<void>) | null {
    if (platform() !== "linux") return null
    if (process.env["WAYLAND_DISPLAY"] && which("wl-copy")) {
      console.log("clipboard: using wl-copy")
      return (text: string) => pipeToProc(["wl-copy"], [], text)
    }
    if (which("xclip")) {
      console.log("clipboard: using xclip")
      return (text: string) => pipeToProc(["xclip", "-selection", "clipboard"], [], text)
    }
    if (which("xsel")) {
      console.log("clipboard: using xsel")
      return (text: string) => pipeToProc(["xsel", "--clipboard", "--input"], [], text)
    }
    return null
  }

  function makeWin32Copier(): ((text: string) => Promise<void>) | null {
    if (platform() !== "win32") return null
    console.log("clipboard: using powershell")
    // Pipe via stdin to avoid PowerShell string interpolation ($env:FOO, $(), etc.)
    return (text: string) =>
      pipeToProc(
        [
          "powershell.exe",
          "-NonInteractive",
          "-NoProfile",
          "-Command",
          "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ],
        [],
        text,
      )
  }

  const getCopyMethod = lazy(() => {
    return (
      makeOsascriptCopier() ??
      makeLinuxCopier() ??
      makeWin32Copier() ??
      (console.log("clipboard: no native support"),
      async (text: string) => {
        await clipboardy.write(text).catch(() => {})
      })
    )
  })

  export async function copy(text: string): Promise<void> {
    writeOsc52(text)
    await getCopyMethod()(text)
  }
}
