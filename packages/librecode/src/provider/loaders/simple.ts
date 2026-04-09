/**
 * Simple provider loaders that just configure headers or basic options.
 */

import type { CustomLoader } from "./types"

export const anthropic: CustomLoader = async () => ({
  autoload: false,
  options: {
    headers: {
      "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
    },
  },
})

export const openrouter: CustomLoader = async () => ({
  autoload: false,
  options: {
    headers: {
      "HTTP-Referer": "https://github.com/techtoboggan/librecode/",
      "X-Title": "librecode",
    },
  },
})

export const vercel: CustomLoader = async () => ({
  autoload: false,
  options: {
    headers: {
      "http-referer": "https://github.com/techtoboggan/librecode/",
      "x-title": "librecode",
    },
  },
})

export const zenmux: CustomLoader = async () => ({
  autoload: false,
  options: {
    headers: {
      "HTTP-Referer": "https://github.com/techtoboggan/librecode/",
      "X-Title": "librecode",
    },
  },
})

export const cerebras: CustomLoader = async () => ({
  autoload: false,
  options: {
    headers: {
      "X-Cerebras-3rd-Party-Integration": "librecode",
    },
  },
})

export const kilo: CustomLoader = async () => ({
  autoload: false,
  options: {
    headers: {
      "HTTP-Referer": "https://github.com/techtoboggan/librecode/",
      "X-Title": "librecode",
    },
  },
})
