/**
 * Type definitions for the custom provider loader system.
 *
 * Each provider can register a CustomLoader that returns:
 * - autoload: whether to auto-register when credentials are detected
 * - getModel: custom SDK method selector (responses vs chat vs languageModel)
 * - vars: custom variable resolver for URL templates
 * - options: provider-specific SDK options
 */

export type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>

export type CustomVarsLoader = (options: Record<string, any>) => Record<string, string>

export interface CustomLoaderResult {
  autoload: boolean
  getModel?: CustomModelLoader
  vars?: CustomVarsLoader
  options?: Record<string, any>
}

export type CustomLoader = (provider: {
  id: string
  env: string[]
  options?: Record<string, any>
  models: Record<string, any>
}) => Promise<CustomLoaderResult>
