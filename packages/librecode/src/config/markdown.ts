import { NamedError } from "@librecode/util/error"
import matter from "gray-matter"
import { z } from "zod"
import { Filesystem } from "../util/filesystem"

function sanitizeFrontmatterLine(line: string): string[] {
  const trimmed = line.trim()
  // pass through comments, empty lines, and indented continuations unchanged
  if (trimmed.startsWith("#") || trimmed === "" || line.match(/^\s+/)) return [line]

  const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
  if (!kvMatch) return [line]

  const key = kvMatch[1]
  const value = kvMatch[2].trim()

  // pass through if value is empty, already quoted, or uses block scalar
  if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) return [line]

  // if value contains a colon, convert to block scalar to avoid YAML parse errors
  if (value.includes(":")) return [`${key}: |-`, `  ${value}`]

  return [line]
}

export namespace ConfigMarkdown {
  export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
  export const SHELL_REGEX = /!`([^`]+)`/g

  export function files(template: string) {
    return Array.from(template.matchAll(FILE_REGEX))
  }

  export function shell(template: string) {
    return Array.from(template.matchAll(SHELL_REGEX))
  }

  // other coding agents like claude code allow invalid yaml in their
  // frontmatter, we need to fallback to a more permissive parser for those cases
  export function fallbackSanitization(content: string): string {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return content

    const frontmatter = match[1]
    const lines = frontmatter.split(/\r?\n/)
    const processed = lines.flatMap(sanitizeFrontmatterLine).join("\n")
    return content.replace(frontmatter, () => processed)
  }

  export async function parse(filePath: string) {
    const template = await Filesystem.readText(filePath)

    try {
      const md = matter(template)
      return md
    } catch {
      try {
        return matter(fallbackSanitization(template))
      } catch (err) {
        throw new FrontmatterError(
          {
            path: filePath,
            message: `${filePath}: Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
          },
          { cause: err },
        )
      }
    }
  }

  export const FrontmatterError = NamedError.create(
    "ConfigFrontmatterError",
    z.object({
      path: z.string(),
      message: z.string(),
    }),
  )
}
