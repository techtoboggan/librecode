import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import {
  InstructionPrompt,
  instructionPromptLoaded,
  instructionPromptClear,
} from "../../src/session/instruction"
import { tmpdir } from "../fixture/fixture"

describe("InstructionPrompt.resolve", () => {
  test("returns empty when AGENTS.md is at project root (already in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Root Instructions")
        await Bun.write(path.join(dir, "src", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(path.join(tmp.path, "AGENTS.md"))).toBe(true)

        const results = await InstructionPrompt.resolve([], path.join(tmp.path, "src", "file.ts"), "test-message-1")
        expect(results).toEqual([])
      },
    })
  })

  test("returns AGENTS.md from subdirectory (not in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(path.join(tmp.path, "subdir", "AGENTS.md"))).toBe(false)

        const results = await InstructionPrompt.resolve(
          [],
          path.join(tmp.path, "subdir", "nested", "file.ts"),
          "test-message-2",
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(tmp.path, "subdir", "AGENTS.md"))
      },
    })
  })

  test("doesn't reload AGENTS.md when reading it directly", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filepath = path.join(tmp.path, "subdir", "AGENTS.md")
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(filepath)).toBe(false)

        const results = await InstructionPrompt.resolve([], filepath, "test-message-2")
        expect(results).toEqual([])
      },
    })
  })
})

describe("InstructionPrompt.systemPaths LIBRECODE_CONFIG_DIR", () => {
  let originalConfigDir: string | undefined

  beforeEach(() => {
    originalConfigDir = process.env.LIBRECODE_CONFIG_DIR
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.LIBRECODE_CONFIG_DIR
    } else {
      process.env.LIBRECODE_CONFIG_DIR = originalConfigDir
    }
  })

  test("prefers LIBRECODE_CONFIG_DIR AGENTS.md over global when both exist", async () => {
    await using profileTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Profile Instructions")
      },
    })
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    process.env.LIBRECODE_CONFIG_DIR = profileTmp.path
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(profileTmp.path, "AGENTS.md"))).toBe(true)
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(false)
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })

  test("falls back to global AGENTS.md when LIBRECODE_CONFIG_DIR has no AGENTS.md", async () => {
    await using profileTmp = await tmpdir()
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    process.env.LIBRECODE_CONFIG_DIR = profileTmp.path
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(profileTmp.path, "AGENTS.md"))).toBe(false)
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })

  test("uses global AGENTS.md when LIBRECODE_CONFIG_DIR is not set", async () => {
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    delete process.env.LIBRECODE_CONFIG_DIR
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })
})

describe("InstructionPrompt.loaded", () => {
  test("returns empty set for messages with no parts", () => {
    const result = instructionPromptLoaded([])
    expect(result.size).toBe(0)
  })

  test("returns empty set for messages with non-tool parts", () => {
    const messages = [
      {
        parts: [
          {
            type: "text" as const,
            text: "hello",
            id: "p1" as never,
            sessionID: "s1" as never,
            messageID: "m1" as never,
          },
        ],
      },
    ] as never
    const result = instructionPromptLoaded(messages)
    expect(result.size).toBe(0)
  })

  test("extracts loaded paths from completed read tool parts", () => {
    const messages = [
      {
        parts: [
          {
            type: "tool" as const,
            tool: "read",
            callID: "call-1",
            id: "p1" as never,
            sessionID: "s1" as never,
            messageID: "m1" as never,
            state: {
              status: "completed" as const,
              input: {},
              output: "file content",
              title: "read",
              metadata: { loaded: ["/tmp/foo.ts", "/tmp/bar.ts"] },
              time: { start: 1000, end: 2000 },
            },
          },
        ],
      },
    ] as never
    const result = instructionPromptLoaded(messages)
    expect(result.has("/tmp/foo.ts")).toBe(true)
    expect(result.has("/tmp/bar.ts")).toBe(true)
  })

  test("ignores compacted read parts", () => {
    const messages = [
      {
        parts: [
          {
            type: "tool" as const,
            tool: "read",
            callID: "call-2",
            id: "p2" as never,
            sessionID: "s1" as never,
            messageID: "m1" as never,
            state: {
              status: "completed" as const,
              input: {},
              output: "content",
              title: "read",
              metadata: { loaded: ["/tmp/compacted.ts"] },
              time: { start: 1000, end: 2000, compacted: 3000 },
            },
          },
        ],
      },
    ] as never
    const result = instructionPromptLoaded(messages)
    // compacted parts are excluded
    expect(result.has("/tmp/compacted.ts")).toBe(false)
  })

  test("ignores non-read tool parts", () => {
    const messages = [
      {
        parts: [
          {
            type: "tool" as const,
            tool: "bash",
            callID: "call-3",
            id: "p3" as never,
            sessionID: "s1" as never,
            messageID: "m1" as never,
            state: {
              status: "completed" as const,
              input: {},
              output: "ok",
              title: "bash",
              metadata: { loaded: ["/tmp/bash-file.ts"] },
              time: { start: 1000, end: 2000 },
            },
          },
        ],
      },
    ] as never
    const result = instructionPromptLoaded(messages)
    expect(result.has("/tmp/bash-file.ts")).toBe(false)
  })

  test("ignores non-string entries in loaded array", () => {
    const messages = [
      {
        parts: [
          {
            type: "tool" as const,
            tool: "read",
            callID: "call-4",
            id: "p4" as never,
            sessionID: "s1" as never,
            messageID: "m1" as never,
            state: {
              status: "completed" as const,
              input: {},
              output: "content",
              title: "read",
              metadata: { loaded: ["/tmp/valid.ts", 42, null, { bad: true }] },
              time: { start: 1000, end: 2000 },
            },
          },
        ],
      },
    ] as never
    const result = instructionPromptLoaded(messages)
    expect(result.has("/tmp/valid.ts")).toBe(true)
    expect(result.size).toBe(1)
  })
})

describe("InstructionPrompt.find", () => {
  test("finds AGENTS.md in given directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Instructions")
      },
    })
    const result = await InstructionPrompt.find(tmp.path)
    expect(result).toBe(path.join(tmp.path, "AGENTS.md"))
  })

  test("finds CLAUDE.md when AGENTS.md is absent", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "CLAUDE.md"), "# Claude Instructions")
      },
    })
    const result = await InstructionPrompt.find(tmp.path)
    expect(result).toBe(path.join(tmp.path, "CLAUDE.md"))
  })

  test("returns undefined when no instruction files exist", async () => {
    await using tmp = await tmpdir()
    const result = await InstructionPrompt.find(tmp.path)
    expect(result).toBeUndefined()
  })
})

describe("InstructionPrompt.systemPaths with config instructions", () => {
  test("http/https instructions are skipped in systemPaths but included in system()", async () => {
    await using projectTmp = await tmpdir({
      config: { instructions: ["https://example.com/AGENTS.md"] },
    })
    await Instance.provide({
      directory: projectTmp.path,
      fn: async () => {
        // systemPaths should not include URL paths
        const paths = await InstructionPrompt.systemPaths()
        for (const p of paths) {
          expect(p).not.toContain("https://")
        }
      },
    })
  })

  test("absolute path instruction is resolved if it exists", async () => {
    await using instructionTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "my-instructions.md"), "# My Instructions")
      },
    })
    await using projectTmp = await tmpdir({
      config: { instructions: [path.join(instructionTmp.path, "my-instructions.md")] },
    })
    await Instance.provide({
      directory: projectTmp.path,
      fn: async () => {
        const paths = await InstructionPrompt.systemPaths()
        expect(paths.has(path.join(instructionTmp.path, "my-instructions.md"))).toBe(true)
      },
    })
  })
})

describe("InstructionPrompt.clear", () => {
  test("clear removes claims for a messageID", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const mid = "test-clear-msg"
        const filepath = path.join(tmp.path, "subdir", "nested", "file.ts")

        // First resolve should find the AGENTS.md
        const first = await InstructionPrompt.resolve([], filepath, mid)
        expect(first.length).toBe(1)

        // Second resolve should return empty (already claimed)
        const second = await InstructionPrompt.resolve([], filepath, mid)
        expect(second).toEqual([])

        // After clear, resolve should find it again
        instructionPromptClear(mid)
        const third = await InstructionPrompt.resolve([], filepath, mid)
        expect(third.length).toBe(1)
      },
    })
  })
})

describe("InstructionPrompt.systemPaths LIBRECODE_DISABLE_PROJECT_CONFIG", () => {
  let originalDisableProjectConfig: string | undefined

  beforeEach(() => {
    originalDisableProjectConfig = process.env.LIBRECODE_DISABLE_PROJECT_CONFIG
  })

  afterEach(() => {
    if (originalDisableProjectConfig === undefined) {
      delete process.env.LIBRECODE_DISABLE_PROJECT_CONFIG
    } else {
      process.env.LIBRECODE_DISABLE_PROJECT_CONFIG = originalDisableProjectConfig
    }
  })

  test("LIBRECODE_DISABLE_PROJECT_CONFIG skips project file discovery", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Project Instructions")
      },
    })
    process.env.LIBRECODE_DISABLE_PROJECT_CONFIG = "1"
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const paths = await InstructionPrompt.systemPaths()
        // Project AGENTS.md should NOT be included when project config is disabled
        expect(paths.has(path.join(tmp.path, "AGENTS.md"))).toBe(false)
      },
    })
  })
})

describe("InstructionPrompt.systemPaths — instruction resolution edge cases", () => {
  let savedConfigDir: string | undefined
  let savedDisableProject: string | undefined

  beforeEach(() => {
    savedConfigDir = process.env.LIBRECODE_CONFIG_DIR
    savedDisableProject = process.env.LIBRECODE_DISABLE_PROJECT_CONFIG
  })

  afterEach(() => {
    if (savedConfigDir === undefined) delete process.env.LIBRECODE_CONFIG_DIR
    else process.env.LIBRECODE_CONFIG_DIR = savedConfigDir

    if (savedDisableProject === undefined) delete process.env.LIBRECODE_DISABLE_PROJECT_CONFIG
    else process.env.LIBRECODE_DISABLE_PROJECT_CONFIG = savedDisableProject
  })

  test("with DISABLE_PROJECT_CONFIG + LIBRECODE_CONFIG_DIR, resolves relative instruction against config dir", async () => {
    await using configDirTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "rules.md"), "# Config Dir Rules")
        // Also write the config file in the config dir so it gets loaded via LIBRECODE_CONFIG_DIR
        await Bun.write(
          path.join(dir, "librecode.json"),
          JSON.stringify({ $schema: "https://librecode.app/config.json", instructions: ["rules.md"] }),
        )
      },
    })
    await using projectTmp = await tmpdir()

    process.env.LIBRECODE_DISABLE_PROJECT_CONFIG = "1"
    process.env.LIBRECODE_CONFIG_DIR = configDirTmp.path

    await Instance.provide({
      directory: projectTmp.path,
      fn: async () => {
        const paths = await InstructionPrompt.systemPaths()
        // The relative instruction "rules.md" should be resolved against LIBRECODE_CONFIG_DIR
        expect(paths.has(path.join(configDirTmp.path, "rules.md"))).toBe(true)
      },
    })
  })

  test("with DISABLE_PROJECT_CONFIG but no LIBRECODE_CONFIG_DIR, skips relative instruction gracefully", async () => {
    await using configDirTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "librecode.json"),
          JSON.stringify({
            $schema: "https://librecode.app/config.json",
            instructions: ["relative-instruction.md"],
          }),
        )
      },
    })
    await using projectTmp = await tmpdir()

    process.env.LIBRECODE_DISABLE_PROJECT_CONFIG = "1"
    process.env.LIBRECODE_CONFIG_DIR = configDirTmp.path
    // Now delete LIBRECODE_CONFIG_DIR to trigger the warning path
    delete process.env.LIBRECODE_CONFIG_DIR

    await Instance.provide({
      directory: projectTmp.path,
      fn: async () => {
        // Should not throw; relative instructions are silently skipped when no config dir
        const paths = await InstructionPrompt.systemPaths()
        for (const p of paths) {
          expect(p).not.toContain("relative-instruction.md")
        }
      },
    })
  })

  test("absolute instruction path that does not exist is silently skipped", async () => {
    await using projectTmp = await tmpdir({
      config: { instructions: ["/nonexistent/path/to/AGENTS.md"] },
    })

    await Instance.provide({
      directory: projectTmp.path,
      fn: async () => {
        const paths = await InstructionPrompt.systemPaths()
        expect(paths.has("/nonexistent/path/to/AGENTS.md")).toBe(false)
      },
    })
  })
})
