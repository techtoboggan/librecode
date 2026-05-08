/**
 * v0.9.78 — tests for `Config.deleteGlobalPaths`.
 *
 * The patch endpoint can't express deletion (its merge step skips
 * `undefined`), so the local-server-wizard's "uncheck a model" intent
 * had no working backend. This route is what closes that gap. Test
 * matrix: both `.json` and `.jsonc` files, missing keys, defensive
 * path validation, idempotency.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

let prevConfigPath: string

afterEach(() => {
  ;(Global.Path as { config: string }).config = prevConfigPath
  Config.global.reset()
})

async function withGlobalConfig(opts: { filename: string; contents: string }, fn: () => Promise<void>): Promise<void> {
  await using globalTmp = await tmpdir()
  prevConfigPath = Global.Path.config
  ;(Global.Path as { config: string }).config = globalTmp.path
  Config.global.reset()
  await Filesystem.write(path.join(globalTmp.path, opts.filename), opts.contents)
  await fn()
}

beforeEach(() => {
  prevConfigPath = Global.Path.config
})

describe("Config.deleteGlobalPaths — JSONC files (most common)", () => {
  test("removes a single nested key without disturbing siblings", async () => {
    await withGlobalConfig(
      {
        filename: "librecode.jsonc",
        contents: `{
  // user added these via the wizard
  "provider": {
    "local-foo": {
      "npm": "@ai-sdk/openai-compatible",
      "models": {
        "llama3:8b": { "name": "llama3:8b" },
        "qwen2:7b": { "name": "qwen2:7b" }
      }
    }
  }
}
`,
      },
      async () => {
        const next = await Config.deleteGlobalPaths([["provider", "local-foo", "models", "llama3:8b"]])
        expect(next.provider?.["local-foo"]?.models).toBeDefined()
        expect(Object.keys(next.provider?.["local-foo"]?.models ?? {})).toEqual(["qwen2:7b"])
        // The comment, sibling provider keys, and structure all stay intact.
        const after = await Filesystem.readText(path.join(Global.Path.config, "librecode.jsonc"))
        expect(after).toContain("user added these via the wizard")
        expect(after).toContain("qwen2:7b")
        expect(after).not.toContain("llama3:8b")
      },
    )
  })

  test("multiple paths in one call — applies them serially", async () => {
    await withGlobalConfig(
      {
        filename: "librecode.jsonc",
        contents: `{
  "provider": {
    "local-bar": {
      "npm": "@ai-sdk/openai-compatible",
      "models": {
        "a": { "name": "a" },
        "b": { "name": "b" },
        "c": { "name": "c" }
      }
    }
  }
}
`,
      },
      async () => {
        const next = await Config.deleteGlobalPaths([
          ["provider", "local-bar", "models", "a"],
          ["provider", "local-bar", "models", "c"],
        ])
        expect(Object.keys(next.provider?.["local-bar"]?.models ?? {})).toEqual(["b"])
      },
    )
  })

  test("missing path is a no-op (idempotent)", async () => {
    await withGlobalConfig(
      {
        filename: "librecode.jsonc",
        contents: `{ "provider": { "local-x": { "models": { "a": { "name": "a" } } } } }`,
      },
      async () => {
        const next = await Config.deleteGlobalPaths([["provider", "local-x", "models", "nonexistent"]])
        // The unrelated existing model is preserved.
        expect(Object.keys(next.provider?.["local-x"]?.models ?? {})).toEqual(["a"])
      },
    )
  })

  test("removing a top-level provider drops all of its models in one shot", async () => {
    await withGlobalConfig(
      {
        filename: "librecode.jsonc",
        contents: `{
  "provider": {
    "local-y": { "npm": "@ai-sdk/openai-compatible", "models": { "a": {}, "b": {} } },
    "local-z": { "npm": "@ai-sdk/openai-compatible", "models": { "c": {} } }
  }
}
`,
      },
      async () => {
        const next = await Config.deleteGlobalPaths([["provider", "local-y"]])
        expect(next.provider?.["local-y"]).toBeUndefined()
        expect(next.provider?.["local-z"]).toBeDefined()
      },
    )
  })
})

describe("Config.deleteGlobalPaths — plain JSON files", () => {
  test("removes a key from a librecode.json file the same way", async () => {
    await withGlobalConfig(
      {
        filename: "librecode.json",
        contents: JSON.stringify({
          provider: {
            "local-q": {
              npm: "@ai-sdk/openai-compatible",
              models: {
                keep: { name: "keep" },
                drop: { name: "drop" },
              },
            },
          },
        }),
      },
      async () => {
        const next = await Config.deleteGlobalPaths([["provider", "local-q", "models", "drop"]])
        expect(Object.keys(next.provider?.["local-q"]?.models ?? {})).toEqual(["keep"])
      },
    )
  })
})

describe("Config.deleteGlobalPaths — defensive path validation", () => {
  test("rejects paths shorter than 2 segments (refuses to nuke top-level)", async () => {
    await withGlobalConfig(
      {
        filename: "librecode.jsonc",
        contents: `{ "provider": {} }`,
      },
      async () => {
        await expect(Config.deleteGlobalPaths([["provider"]])).rejects.toThrow(/too-shallow/)
      },
    )
  })

  test("rejects paths whose first segment isn't a known config field", async () => {
    await withGlobalConfig(
      {
        filename: "librecode.jsonc",
        contents: `{ "provider": {} }`,
      },
      async () => {
        await expect(Config.deleteGlobalPaths([["secrets", "anthropic"]])).rejects.toThrow(/known config surface/)
      },
    )
  })

  test("rejects paths with empty or non-string segments", async () => {
    await withGlobalConfig(
      {
        filename: "librecode.jsonc",
        contents: `{ "provider": {} }`,
      },
      async () => {
        await expect(Config.deleteGlobalPaths([["provider", ""]])).rejects.toThrow(/invalid path segment/)
      },
    )
  })
})
