import { createRequire } from "node:module"
import path from "node:path"

export function moduleResolve(id: string, dir: string): string | undefined {
  try {
    return createRequire(path.join(dir, "package.json")).resolve(id)
  } catch {}
}

export const Module = {
  resolve: moduleResolve,
} as const
