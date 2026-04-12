import { createHash } from "node:crypto"

function hashFast(input: string | Buffer): string {
  return createHash("sha1").update(input).digest("hex")
}

export const Hash = {
  fast: hashFast,
} as const
