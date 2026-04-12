import { EOL } from "node:os"
import { NamedError } from "@librecode/util/error"
import z from "zod"
import { logo as glyphs } from "./logo"

function drawLogoLine(line: string, fg: string, shadow: string, bg: string, reset: string): string {
  const parts: string[] = []
  for (const char of line) {
    if (char === "_") {
      parts.push(bg, " ", reset)
    } else if (char === "^") {
      parts.push(fg, bg, "▀", reset)
    } else if (char === "~") {
      parts.push(shadow, "▀", reset)
    } else if (char === " ") {
      parts.push(" ")
    } else {
      parts.push(fg, char, reset)
    }
  }
  return parts.join("")
}

const CancelledError = NamedError.create("UICancelledError", z.void())

const Style = {
  TEXT_HIGHLIGHT: "\x1b[96m",
  TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
  TEXT_DIM: "\x1b[90m",
  TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
  TEXT_NORMAL: "\x1b[0m",
  TEXT_NORMAL_BOLD: "\x1b[1m",
  TEXT_WARNING: "\x1b[93m",
  TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
  TEXT_DANGER: "\x1b[91m",
  TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
  TEXT_SUCCESS: "\x1b[92m",
  TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
  TEXT_INFO: "\x1b[94m",
  TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
}

function uiPrint(...message: string[]): void {
  blank = false
  process.stderr.write(message.join(" "))
}

function uiPrintln(...message: string[]): void {
  uiPrint(...message)
  process.stderr.write(EOL)
}

let blank = false
function uiEmpty(): void {
  if (blank) return
  uiPrintln(`${Style.TEXT_NORMAL}`)
  blank = true
}

function uiLogo(pad?: string): string {
  const reset = "\x1b[0m"
  const left = { fg: "\x1b[90m", shadow: "\x1b[38;5;235m", bg: "\x1b[48;5;235m" }
  const right = { fg: reset, shadow: "\x1b[38;5;238m", bg: "\x1b[48;5;238m" }
  const gap = " "
  const result: string[] = []
  glyphs.left.forEach((row, index) => {
    if (pad) result.push(pad)
    result.push(drawLogoLine(row, left.fg, left.shadow, left.bg, reset))
    result.push(gap)
    const other = glyphs.right[index] ?? ""
    result.push(drawLogoLine(other, right.fg, right.shadow, right.bg, reset))
    result.push(EOL)
  })
  return result.join("").trimEnd()
}

async function uiInput(prompt: string): Promise<string> {
  const readline = require("node:readline")
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function uiError(message: string): void {
  if (message.startsWith("Error: ")) {
    message = message.slice("Error: ".length)
  }
  uiPrintln(`${Style.TEXT_DANGER_BOLD}Error: ${Style.TEXT_NORMAL}${message}`)
}

function uiMarkdown(text: string): string {
  return text
}

export const UI = {
  CancelledError,
  Style,
  println: uiPrintln,
  print: uiPrint,
  empty: uiEmpty,
  logo: uiLogo,
  input: uiInput,
  error: uiError,
  markdown: uiMarkdown,
} as const
