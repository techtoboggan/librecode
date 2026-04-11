import { describe, expect, test } from "bun:test"
import { detectCapabilitiesFromId } from "../../src/provider/detect-capabilities"

describe("detectCapabilitiesFromId", () => {
  describe("vision detection", () => {
    test("detects -vision suffix", () => {
      expect(detectCapabilitiesFromId("llama3.2-vision").vision).toBe(true)
      expect(detectCapabilitiesFromId("grok-2-vision").vision).toBe(true)
    })

    test("detects LLaVA family", () => {
      expect(detectCapabilitiesFromId("llava:13b").vision).toBe(true)
      expect(detectCapabilitiesFromId("llava-phi3").vision).toBe(true)
      expect(detectCapabilitiesFromId("bakllava").vision).toBe(true)
    })

    test("detects Pixtral", () => {
      expect(detectCapabilitiesFromId("pixtral-large").vision).toBe(true)
    })

    test("detects VL (vision-language)", () => {
      expect(detectCapabilitiesFromId("qwen-vl").vision).toBe(true)
      expect(detectCapabilitiesFromId("internvl2").vision).toBe(true)
      expect(detectCapabilitiesFromId("internvl2.5").vision).toBe(true)
    })

    test("detects moondream", () => {
      expect(detectCapabilitiesFromId("moondream2").vision).toBe(true)
      expect(detectCapabilitiesFromId("moondream:latest").vision).toBe(true)
    })

    test("non-vision models are false", () => {
      expect(detectCapabilitiesFromId("llama3.2").vision).toBe(false)
      expect(detectCapabilitiesFromId("mistral-7b").vision).toBe(false)
      expect(detectCapabilitiesFromId("deepseek-coder").vision).toBe(false)
    })
  })

  describe("reasoning detection", () => {
    test("detects DeepSeek-R1", () => {
      expect(detectCapabilitiesFromId("deepseek-r1").reasoning).toBe(true)
      expect(detectCapabilitiesFromId("deepseek-r1:7b").reasoning).toBe(true)
    })

    test("detects QwQ", () => {
      expect(detectCapabilitiesFromId("qwq-32b").reasoning).toBe(true)
    })

    test("detects thinking/reasoning keyword", () => {
      expect(detectCapabilitiesFromId("claude-3-7-thinking").reasoning).toBe(true)
      expect(detectCapabilitiesFromId("my-reasoning-model").reasoning).toBe(true)
    })

    test("standard models are not reasoning", () => {
      expect(detectCapabilitiesFromId("llama3.3").reasoning).toBe(false)
      expect(detectCapabilitiesFromId("mistral-nemo").reasoning).toBe(false)
    })
  })

  describe("toolcall detection", () => {
    test("chat models support tool calls by default", () => {
      expect(detectCapabilitiesFromId("llama3.3").toolcall).toBe(true)
      expect(detectCapabilitiesFromId("mistral-7b-instruct").toolcall).toBe(true)
    })

    test("base (non-instruct) models do not support tool calls", () => {
      expect(detectCapabilitiesFromId("llama3-base").toolcall).toBe(false)
    })

    test("embedding models do not support tool calls", () => {
      expect(detectCapabilitiesFromId("nomic-embed-text").toolcall).toBe(false)
      expect(detectCapabilitiesFromId("mxbai-embed-large").toolcall).toBe(false)
    })

    test("rerank models do not support tool calls", () => {
      expect(detectCapabilitiesFromId("bge-reranker-v2").toolcall).toBe(false)
    })

    test("whisper audio models do not support tool calls", () => {
      expect(detectCapabilitiesFromId("whisper-large-v3").toolcall).toBe(false)
    })
  })

  describe("combined detection", () => {
    test("vision+toolcall model", () => {
      const caps = detectCapabilitiesFromId("llama3.2-vision-instruct")
      expect(caps.vision).toBe(true)
      expect(caps.toolcall).toBe(true)
      expect(caps.reasoning).toBe(false)
    })

    test("reasoning model", () => {
      const caps = detectCapabilitiesFromId("deepseek-r1:14b")
      expect(caps.vision).toBe(false)
      expect(caps.reasoning).toBe(true)
      expect(caps.toolcall).toBe(true)
    })
  })
})
