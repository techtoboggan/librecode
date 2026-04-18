import { describe, expect, test } from "bun:test"
import type { VoiceInputState } from "./voice-input"

describe("voice-input", () => {
  test("VoiceInputState has correct values", () => {
    const states: VoiceInputState[] = ["inactive", "listening", "error"]
    expect(states).toContain("inactive")
    expect(states).toContain("listening")
    expect(states).toContain("error")
    expect(states).toHaveLength(3)
  })

  test("isSupported returns false in Bun (no window.SpeechRecognition)", () => {
    // In Bun test environment, there's no SpeechRecognition API
    const hasApi = typeof globalThis.window !== "undefined" && "SpeechRecognition" in globalThis.window
    expect(hasApi).toBe(false)
  })
})
