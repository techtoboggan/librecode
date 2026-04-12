import { randomBytes } from "node:crypto"

const IDENTIFIER_LENGTH = 26

// State for monotonic ID generation
let lastTimestamp = 0
let counter = 0

function randomBase62(length: number): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  let result = ""
  const bytes = randomBytes(length)
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % 62]
  }
  return result
}

export function identifierCreate(descending: boolean, timestamp?: number): string {
  const currentTimestamp = timestamp ?? Date.now()

  if (currentTimestamp !== lastTimestamp) {
    lastTimestamp = currentTimestamp
    counter = 0
  }
  counter++

  let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

  now = descending ? ~now : now

  const timeBytes = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }

  return timeBytes.toString("hex") + randomBase62(IDENTIFIER_LENGTH - 12)
}

export function identifierAscending(): string {
  return identifierCreate(false)
}

export function identifierDescending(): string {
  return identifierCreate(true)
}

export const Identifier = {
  create: identifierCreate,
  ascending: identifierAscending,
  descending: identifierDescending,
} as const
