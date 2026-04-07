function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const LIBRECODE_AUTO_SHARE = truthy("LIBRECODE_AUTO_SHARE")
  export const LIBRECODE_GIT_BASH_PATH = process.env["LIBRECODE_GIT_BASH_PATH"]
  export const LIBRECODE_CONFIG = process.env["LIBRECODE_CONFIG"]
  export declare const LIBRECODE_TUI_CONFIG: string | undefined
  export declare const LIBRECODE_CONFIG_DIR: string | undefined
  export const LIBRECODE_CONFIG_CONTENT = process.env["LIBRECODE_CONFIG_CONTENT"]
  export const LIBRECODE_DISABLE_AUTOUPDATE = truthy("LIBRECODE_DISABLE_AUTOUPDATE")
  export const LIBRECODE_DISABLE_PRUNE = truthy("LIBRECODE_DISABLE_PRUNE")
  export const LIBRECODE_DISABLE_TERMINAL_TITLE = truthy("LIBRECODE_DISABLE_TERMINAL_TITLE")
  export const LIBRECODE_PERMISSION = process.env["LIBRECODE_PERMISSION"]
  export const LIBRECODE_DISABLE_DEFAULT_PLUGINS = truthy("LIBRECODE_DISABLE_DEFAULT_PLUGINS")
  export const LIBRECODE_DISABLE_LSP_DOWNLOAD = truthy("LIBRECODE_DISABLE_LSP_DOWNLOAD")
  export const LIBRECODE_ENABLE_EXPERIMENTAL_MODELS = truthy("LIBRECODE_ENABLE_EXPERIMENTAL_MODELS")
  export const LIBRECODE_DISABLE_AUTOCOMPACT = truthy("LIBRECODE_DISABLE_AUTOCOMPACT")
  export const LIBRECODE_DISABLE_MODELS_FETCH = truthy("LIBRECODE_DISABLE_MODELS_FETCH")
  export const LIBRECODE_DISABLE_CLAUDE_CODE = truthy("LIBRECODE_DISABLE_CLAUDE_CODE")
  export const LIBRECODE_DISABLE_CLAUDE_CODE_PROMPT =
    LIBRECODE_DISABLE_CLAUDE_CODE || truthy("LIBRECODE_DISABLE_CLAUDE_CODE_PROMPT")
  export const LIBRECODE_DISABLE_CLAUDE_CODE_SKILLS =
    LIBRECODE_DISABLE_CLAUDE_CODE || truthy("LIBRECODE_DISABLE_CLAUDE_CODE_SKILLS")
  export const LIBRECODE_DISABLE_EXTERNAL_SKILLS =
    LIBRECODE_DISABLE_CLAUDE_CODE_SKILLS || truthy("LIBRECODE_DISABLE_EXTERNAL_SKILLS")
  export declare const LIBRECODE_DISABLE_PROJECT_CONFIG: boolean
  export const LIBRECODE_FAKE_VCS = process.env["LIBRECODE_FAKE_VCS"]
  export declare const LIBRECODE_CLIENT: string
  export const LIBRECODE_SERVER_PASSWORD = process.env["LIBRECODE_SERVER_PASSWORD"]
  export const LIBRECODE_SERVER_USERNAME = process.env["LIBRECODE_SERVER_USERNAME"]
  export const LIBRECODE_ENABLE_QUESTION_TOOL = truthy("LIBRECODE_ENABLE_QUESTION_TOOL")

  // Experimental
  export const LIBRECODE_EXPERIMENTAL = truthy("LIBRECODE_EXPERIMENTAL")
  export const LIBRECODE_EXPERIMENTAL_FILEWATCHER = truthy("LIBRECODE_EXPERIMENTAL_FILEWATCHER")
  export const LIBRECODE_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("LIBRECODE_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const LIBRECODE_EXPERIMENTAL_ICON_DISCOVERY =
    LIBRECODE_EXPERIMENTAL || truthy("LIBRECODE_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["LIBRECODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const LIBRECODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("LIBRECODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const LIBRECODE_ENABLE_EXA =
    truthy("LIBRECODE_ENABLE_EXA") || LIBRECODE_EXPERIMENTAL || truthy("LIBRECODE_EXPERIMENTAL_EXA")
  export const LIBRECODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("LIBRECODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const LIBRECODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("LIBRECODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const LIBRECODE_EXPERIMENTAL_OXFMT = LIBRECODE_EXPERIMENTAL || truthy("LIBRECODE_EXPERIMENTAL_OXFMT")
  export const LIBRECODE_EXPERIMENTAL_LSP_TY = truthy("LIBRECODE_EXPERIMENTAL_LSP_TY")
  export const LIBRECODE_EXPERIMENTAL_LSP_TOOL = LIBRECODE_EXPERIMENTAL || truthy("LIBRECODE_EXPERIMENTAL_LSP_TOOL")
  export const LIBRECODE_DISABLE_FILETIME_CHECK = truthy("LIBRECODE_DISABLE_FILETIME_CHECK")
  export const LIBRECODE_EXPERIMENTAL_PLAN_MODE = LIBRECODE_EXPERIMENTAL || truthy("LIBRECODE_EXPERIMENTAL_PLAN_MODE")
  export const LIBRECODE_EXPERIMENTAL_WORKSPACES = LIBRECODE_EXPERIMENTAL || truthy("LIBRECODE_EXPERIMENTAL_WORKSPACES")
  export const LIBRECODE_EXPERIMENTAL_MARKDOWN = !falsy("LIBRECODE_EXPERIMENTAL_MARKDOWN")
  export const LIBRECODE_MODELS_URL = process.env["LIBRECODE_MODELS_URL"]
  export const LIBRECODE_MODELS_PATH = process.env["LIBRECODE_MODELS_PATH"]
  export const LIBRECODE_DISABLE_CHANNEL_DB = truthy("LIBRECODE_DISABLE_CHANNEL_DB")
  export const LIBRECODE_SKIP_MIGRATIONS = truthy("LIBRECODE_SKIP_MIGRATIONS")
  export const LIBRECODE_STRICT_CONFIG_DEPS = truthy("LIBRECODE_STRICT_CONFIG_DEPS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for LIBRECODE_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "LIBRECODE_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("LIBRECODE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LIBRECODE_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "LIBRECODE_TUI_CONFIG", {
  get() {
    return process.env["LIBRECODE_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LIBRECODE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "LIBRECODE_CONFIG_DIR", {
  get() {
    return process.env["LIBRECODE_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LIBRECODE_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "LIBRECODE_CLIENT", {
  get() {
    return process.env["LIBRECODE_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
