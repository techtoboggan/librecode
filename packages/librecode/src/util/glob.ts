import { type GlobOptions as LibGlobOptions, glob, globSync } from "glob"
import { minimatch } from "minimatch"

export interface GlobOptions {
  cwd?: string
  absolute?: boolean
  include?: "file" | "all"
  dot?: boolean
  symlink?: boolean
}

function toLibGlobOptions(options: GlobOptions): LibGlobOptions {
  return {
    cwd: options.cwd,
    absolute: options.absolute,
    dot: options.dot,
    follow: options.symlink ?? false,
    nodir: options.include !== "all",
  }
}

async function globScan(pattern: string, options: GlobOptions = {}): Promise<string[]> {
  return glob(pattern, toLibGlobOptions(options)) as Promise<string[]>
}

function globScanSync(pattern: string, options: GlobOptions = {}): string[] {
  return globSync(pattern, toLibGlobOptions(options)) as string[]
}

function globMatch(pattern: string, filepath: string): boolean {
  return minimatch(filepath, pattern, { dot: true })
}

export const Glob = {
  scan: globScan,
  scanSync: globScanSync,
  match: globMatch,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Glob {
  type Options = GlobOptions
}
