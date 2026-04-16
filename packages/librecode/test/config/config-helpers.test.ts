/**
 * Tests for pure helper functions exposed through Config:
 *  - Config.getPluginName
 *  - Config.deduplicatePlugins
 *  - managedConfigDir (env override path)
 *
 * These are exercised directly without spinning up the full config pipeline,
 * so they run fast and without I/O.
 */
import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"

// ---------------------------------------------------------------------------
// Config.getPluginName
// ---------------------------------------------------------------------------

describe("Config.getPluginName", () => {
  test("extracts filename stem from file:// URLs", () => {
    expect(Config.getPluginName("file:///path/to/plugin/foo.js")).toBe("foo")
    expect(Config.getPluginName("file:///plugins/my-plugin.ts")).toBe("my-plugin")
    expect(Config.getPluginName("file:///a/b/c/index.js")).toBe("index")
  })

  test("strips @version suffix from plain package names", () => {
    expect(Config.getPluginName("oh-my-librecode@2.4.3")).toBe("oh-my-librecode")
    expect(Config.getPluginName("plugin@1.0.0-beta.1")).toBe("plugin")
  })

  test("strips @version suffix from scoped packages (preserves leading @)", () => {
    expect(Config.getPluginName("@scope/pkg@1.0.0")).toBe("@scope/pkg")
    expect(Config.getPluginName("@librecode/plugin@0.5.0")).toBe("@librecode/plugin")
  })

  test("returns the whole string when no version suffix and not a URL", () => {
    // A bare scoped package without a version: lastIndexOf('@') is 0 (leading @)
    // → should return the whole string unchanged
    expect(Config.getPluginName("@scope/pkg")).toBe("@scope/pkg")
    expect(Config.getPluginName("plain-plugin")).toBe("plain-plugin")
  })
})

// ---------------------------------------------------------------------------
// Config.deduplicatePlugins
// ---------------------------------------------------------------------------

describe("Config.deduplicatePlugins", () => {
  test("returns empty array for empty input", () => {
    expect(Config.deduplicatePlugins([])).toEqual([])
  })

  test("returns plugins unchanged when all are unique", () => {
    const plugins = ["foo@1.0.0", "bar@2.0.0", "@scope/baz@3.0.0"]
    expect(Config.deduplicatePlugins(plugins)).toEqual(plugins)
  })

  test("deduplicates by canonical name, keeping last (highest-priority) specifier", () => {
    // Plugins are added low→high priority; last occurrence wins.
    const plugins = ["foo@1.0.0", "bar@2.0.0", "foo@3.0.0"]
    const result = Config.deduplicatePlugins(plugins)
    // "foo" should only appear once; the higher-priority version (foo@3.0.0) should win
    const foos = result.filter((p) => p.startsWith("foo"))
    expect(foos).toHaveLength(1)
    expect(foos[0]).toBe("foo@3.0.0")
    // "bar" should still be present
    expect(result).toContain("bar@2.0.0")
  })

  test("preserves original order after deduplication", () => {
    const plugins = ["alpha@1.0.0", "beta@1.0.0", "alpha@2.0.0", "gamma@1.0.0"]
    const result = Config.deduplicatePlugins(plugins)
    // After dedup: alpha@2 wins, result should be ordered [beta, alpha@2, gamma]
    expect(result.indexOf("beta@1.0.0")).toBeLessThan(result.indexOf("alpha@2.0.0"))
    expect(result.indexOf("alpha@2.0.0")).toBeLessThan(result.indexOf("gamma@1.0.0"))
    expect(result).not.toContain("alpha@1.0.0")
  })

  test("handles file:// URL duplicates by stem name", () => {
    const plugins = [
      "file:///global/plugins/my-plugin.js",
      "bar@1.0.0",
      "file:///local/plugins/my-plugin.js",
    ]
    const result = Config.deduplicatePlugins(plugins)
    const filePlugins = result.filter((p) => p.startsWith("file://"))
    expect(filePlugins).toHaveLength(1)
    // Local (later = higher priority) wins
    expect(filePlugins[0]).toBe("file:///local/plugins/my-plugin.js")
  })

  test("handles a single plugin without modification", () => {
    expect(Config.deduplicatePlugins(["only-one@1.0.0"])).toEqual(["only-one@1.0.0"])
  })

  test("deduplicates scoped packages correctly", () => {
    const plugins = ["@scope/pkg@1.0.0", "@other/pkg@1.0.0", "@scope/pkg@2.0.0"]
    const result = Config.deduplicatePlugins(plugins)
    const scoped = result.filter((p) => p.startsWith("@scope/pkg"))
    expect(scoped).toHaveLength(1)
    expect(scoped[0]).toBe("@scope/pkg@2.0.0")
    expect(result).toContain("@other/pkg@1.0.0")
  })
})

// ---------------------------------------------------------------------------
// managedConfigDir env override
// ---------------------------------------------------------------------------

describe("Config.managedConfigDir", () => {
  test("returns env override when LIBRECODE_TEST_MANAGED_CONFIG_DIR is set", () => {
    // preload.ts sets LIBRECODE_TEST_MANAGED_CONFIG_DIR for tests
    const fromEnv = process.env.LIBRECODE_TEST_MANAGED_CONFIG_DIR
    if (fromEnv) {
      expect(Config.managedConfigDir()).toBe(fromEnv)
    }
  })

  test("returns a string (some platform default or env value)", () => {
    expect(typeof Config.managedConfigDir()).toBe("string")
    expect(Config.managedConfigDir().length).toBeGreaterThan(0)
  })
})
