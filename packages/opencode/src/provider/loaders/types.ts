/**
 * Provider loader types — aligned with ProviderPlugin interface (plugin-api.ts).
 *
 * CustomLoader is the internal implementation type used by built-in loaders.
 * It mirrors ProviderLoadResult from the public plugin API.
 */

import type { ProviderInfo, ProviderLoadResult } from "../plugin-api"

/**
 * A custom provider loader function.
 * Takes provider info from the models database and returns load configuration.
 *
 * This is the internal equivalent of ProviderPlugin.load() — same shape,
 * same contract, just used for built-in loaders that don't go through
 * the plugin system.
 */
export type CustomLoader = (provider: ProviderInfo) => Promise<ProviderLoadResult>

// Re-export for convenience
export type { ProviderInfo, ProviderLoadResult }
export type CustomModelLoader = ProviderLoadResult["getModel"]
export type CustomVarsLoader = ProviderLoadResult["vars"]
