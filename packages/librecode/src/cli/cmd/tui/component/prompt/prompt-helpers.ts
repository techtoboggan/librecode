import type { PromptInfo } from "./history"

// ---------------------------------------------------------------------------
// Module-level pure helpers — no captured state, safe to import anywhere
// ---------------------------------------------------------------------------

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

export function updatedFilePartPosition(
  part: Extract<PromptInfo["parts"][number], { type: "file" }>,
  newStart: number,
  newEnd: number,
): typeof part {
  if (!part.source?.text) return part
  return {
    ...part,
    source: {
      ...part.source,
      text: { ...part.source.text, start: newStart, end: newEnd },
    },
  }
}

export function updatedAgentPartPosition(
  part: Extract<PromptInfo["parts"][number], { type: "agent" }>,
  newStart: number,
  newEnd: number,
): typeof part {
  if (!part.source) return part
  return {
    ...part,
    source: { ...part.source, start: newStart, end: newEnd },
  }
}

export function resolvePartVirtualText(part: PromptInfo["parts"][number]): string {
  if (part.type === "file" && part.source?.text) return part.source.text.value
  if (part.type === "agent" && part.source) return part.source.value
  return ""
}

export function updatedPartPositionInContent(
  part: PromptInfo["parts"][number],
  content: string,
): PromptInfo["parts"][number] | null {
  const virtualText = resolvePartVirtualText(part)
  if (!virtualText) return part

  const newStart = content.indexOf(virtualText)
  if (newStart === -1) return null
  const newEnd = newStart + virtualText.length

  if (part.type === "file") return updatedFilePartPosition(part, newStart, newEnd)
  if (part.type === "agent") return updatedAgentPartPosition(part, newStart, newEnd)
  return part
}

export function buildCommandArgs(inputText: string): { commandName: string; args: string } {
  const firstLineEnd = inputText.indexOf("\n")
  const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
  const [commandToken, ...firstLineArgs] = firstLine.split(" ")
  const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
  const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")
  return { commandName: commandToken.slice(1), args }
}

export function isKnownSlashCommand(inputText: string, knownCommands: { name: string }[]): boolean {
  if (!inputText.startsWith("/")) return false
  const firstLine = inputText.split("\n")[0]
  const command = firstLine.split(" ")[0].slice(1)
  return knownCommands.some((x) => x.name === command)
}
