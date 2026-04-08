/**
 * Provider Plugin API
 *
 * This module defines the public contract for adding new LLM providers to LibreCode.
 * Providers can be added either as:
 *   1. Built-in loaders (in src/provider/loaders/)
 *   2. External plugins (via the plugin system)
 *
 * A provider plugin must implement the ProviderPlugin interface.
 *
 * ## Lifecycle
 *
 * 1. **Discovery**: Provider info loaded from models.dev database or user config
 * 2. **Loading**: Plugin's `load()` called with provider info
 *    - Returns whether to auto-register (credential detection)
 *    - Returns SDK options, custom model selector, variable resolvers
 * 3. **SDK creation**: When a model is first used, the SDK is instantiated
 *    with the options returned by `load()`
 * 4. **Model resolution**: Plugin's `getModel()` called to select the right
 *    SDK method (chat vs responses vs languageModel)
 *
 * ## Example
 *
 * ```typescript
 * import { defineProvider } from "@librecode/opencode/provider/plugin-api"
 *
 * export default defineProvider({
 *   id: "my-provider",
 *
 *   // Which @ai-sdk/* package to use for the SDK
 *   sdk: "@ai-sdk/openai-compatible",
 *
 *   // Called during provider initialization
 *   async load(provider) {
 *     const apiKey = process.env.MY_PROVIDER_API_KEY
 *     if (!apiKey) return { autoload: false }
 *
 *     return {
 *       autoload: true,
 *       options: {
 *         apiKey,
 *         baseURL: "https://api.my-provider.com/v1",
 *         headers: {
 *           "X-Source": "librecode",
 *         },
 *       },
 *     }
 *   },
 *
 *   // Optional: customize how models are resolved from the SDK
 *   async getModel(sdk, modelID, options) {
 *     return sdk.chat(modelID)
 *   },
 *
 *   // Optional: resolve custom variables for URL templates
 *   vars(options) {
 *     return {
 *       MY_PROVIDER_REGION: options.region ?? "us-east-1",
 *     }
 *   },
 * })
 * ```
 */

import type { LanguageModelV2 } from "ai"

/**
 * Information about a provider as loaded from the models database or user config.
 * Passed to the plugin's `load()` function.
 */
export interface ProviderInfo {
  /** Provider identifier (e.g., "anthropic", "openai", "amazon-bedrock") */
  id: string

  /** Environment variable names that can provide the API key */
  env: string[]

  /** Provider-specific options from user config */
  options?: Record<string, unknown>

  /** Available models for this provider */
  models: Record<
    string,
    {
      id: string
      name: string
      cost: { input: number; output: number }
      [key: string]: unknown
    }
  >
}

/**
 * Result of a provider plugin's load() function.
 */
export interface ProviderLoadResult {
  /**
   * Whether this provider should be auto-registered.
   * Set to `true` when credentials are detected.
   * Set to `false` to skip registration (no credentials found).
   */
  autoload: boolean

  /**
   * SDK constructor options passed to the @ai-sdk/* create function.
   * E.g., `{ apiKey, baseURL, headers }`.
   */
  options?: Record<string, unknown>

  /**
   * Custom model selector. Override how a model ID is resolved to an
   * AI SDK LanguageModelV2 instance.
   *
   * Use this when the provider needs special handling:
   * - OpenAI: `sdk.responses(modelID)` vs `sdk.chat(modelID)`
   * - Azure: resource name interpolation
   * - Bedrock: cross-region prefix logic
   *
   * If not provided, defaults to `sdk.languageModel(modelID)`.
   */
  getModel?: (sdk: unknown, modelID: string, options?: Record<string, unknown>) => Promise<LanguageModelV2>

  /**
   * Custom variable resolver for URL templates.
   * Returns key-value pairs that replace `${VARIABLE}` in API URLs.
   *
   * Example: Azure uses `${AZURE_RESOURCE_NAME}` in the baseURL.
   */
  vars?: (options: Record<string, unknown>) => Record<string, string>
}

/**
 * A provider plugin definition.
 */
export interface ProviderPlugin {
  /** Provider identifier. Must match the ID used in models.dev or user config. */
  id: string

  /**
   * NPM package name of the @ai-sdk/* provider SDK.
   * If the provider is already bundled, this is optional.
   * If specified and not bundled, LibreCode will auto-install it.
   */
  sdk?: string

  /**
   * Called during provider initialization.
   * Detect credentials and return SDK options.
   */
  load(provider: ProviderInfo): Promise<ProviderLoadResult>

  /**
   * Optional: customize model resolution from the SDK.
   * Shorthand for returning `getModel` from `load()`.
   * If both are provided, `load().getModel` takes precedence.
   */
  getModel?: ProviderLoadResult["getModel"]

  /**
   * Optional: resolve custom variables for URL templates.
   * Shorthand for returning `vars` from `load()`.
   * If both are provided, `load().vars` takes precedence.
   */
  vars?: ProviderLoadResult["vars"]
}

/**
 * Helper to define a provider plugin with type checking.
 */
export function defineProvider(plugin: ProviderPlugin): ProviderPlugin {
  return plugin
}
