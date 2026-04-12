const CHARS_PER_TOKEN = 4

function tokenEstimate(input: string) {
  return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
}

export const Token = {
  estimate: tokenEstimate,
} as const
