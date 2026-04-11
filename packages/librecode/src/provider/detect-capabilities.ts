/**
 * Heuristic capability detection for locally-discovered models.
 *
 * Local model servers don't expose a capability manifest, so we infer from
 * the model ID using known naming conventions. This is best-effort — users can
 * override in config if a model is miscategorised.
 *
 * Mapped fields:
 *   input.image  →  vision support (multimodal input)
 *   toolcall     →  function-calling / tool use
 *   reasoning    →  chain-of-thought / thinking tokens
 */

/** Model ID patterns that indicate vision (multimodal image input) support. */
const VISION_PATTERNS = [
  /\bvision\b/i,
  /\bvl\b/i, // standalone VL (e.g. Qwen-VL)
  /internvl/i, // InternVL family (internvl2, internvl2.5, etc.)
  /llava/i, // LLaVA / BakLLaVA family
  /\bpixtral\b/i, // Mistral's vision model
  /\bvlm\b/i, // generic VLM abbreviation
  /moondream/i, // Moondream2, etc.
  /\bminicpm-v\b/i,
  /\bidefics\b/i,
  /\bpaligemma\b/i,
  /florence/i,
]

/** Model ID patterns that indicate native reasoning / chain-of-thought support. */
const REASONING_PATTERNS = [
  /\breasoning\b/i,
  /\bthinking\b/i,
  /\br1\b/i, // DeepSeek-R1, QwQ variants
  /\bdeepseek-r\d/i,
  /\bqwq\b/i,
  /\bsky-t1\b/i,
]

/** Model ID patterns that indicate tool / function-calling support. */
const NO_TOOLCALL_PATTERNS = [
  /\bbase\b/i, // base (non-instruct) models typically lack tool support
  /\bembedding\b/i,
  /\bembed\b/i,
  /\brerank/i, // reranker, rerank
  /\bclassif/i,
  /\bwhisper\b/i, // audio-only
  /\btts\b/i,
  /\bstt\b/i,
]

export interface DetectedCapabilities {
  /** Whether the model can process image input. */
  vision: boolean
  /** Whether the model supports function calling / tool use. */
  toolcall: boolean
  /** Whether the model has native chain-of-thought reasoning tokens. */
  reasoning: boolean
}

/**
 * Infer model capabilities from its ID string.
 *
 * Results are merged into the model's `capabilities` object when injecting
 * locally-discovered models (LiteLLM, Ollama, vLLM, etc.).
 */
export function detectCapabilitiesFromId(modelId: string): DetectedCapabilities {
  const id = modelId.toLowerCase()
  const vision = VISION_PATTERNS.some((p) => p.test(id))
  const reasoning = REASONING_PATTERNS.some((p) => p.test(id))
  // Most instruct/chat models support tool calls; exclude obvious non-chat models.
  const toolcall = !NO_TOOLCALL_PATTERNS.some((p) => p.test(id))
  return { vision, toolcall, reasoning }
}
