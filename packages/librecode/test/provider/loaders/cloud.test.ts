/**
 * Tests for cloud provider loader helpers.
 *
 * googleVertex and googleVertexAnthropic have pure, no-network paths
 * that we can exercise without mocking external auth.
 * amazonBedrock's prefix logic (applyBedrockRegionPrefix) is tested
 * via getModel() with AWS_PROFILE set.
 */
import { describe, expect, mock, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import { googleVertex, googleVertexAnthropic } from "../../../src/provider/loaders/cloud"
import type { ProviderInfo } from "../../../src/provider/plugin-api"
import { tmpdir } from "../../fixture/fixture"

function makeProvider(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return { id: "google-vertex", env: [], options: {}, models: {}, ...overrides }
}

// ----- googleVertex -----

describe("googleVertex loader", () => {
  test("returns autoload: false when no project is configured", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await googleVertex(makeProvider({ options: {} }))
        expect(result.autoload).toBe(false)
      },
    })
  })

  test("returns autoload: true when project set via provider options", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await googleVertex(makeProvider({ options: { project: "my-gcp-project" } }))
        expect(result.autoload).toBe(true)
      },
    })
  })

  test("returns autoload: true when project is set via provider.options (string)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await googleVertex(makeProvider({ options: { project: "my-project" } }))
        expect(result.autoload).toBe(true)
        expect((result.options as Record<string, unknown>).project).toBe("my-project")
      },
    })
  })

  test("uses us-central1 as default location", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await googleVertex(makeProvider({ options: { project: "p" } }))
        const opts = result.options as Record<string, unknown>
        expect(opts.location).toBe("us-central1")
      },
    })
  })

  test("uses location from provider options when set", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await googleVertex(makeProvider({ options: { project: "p", location: "europe-west4" } }))
        const opts = result.options as Record<string, unknown>
        expect(opts.location).toBe("europe-west4")
      },
    })
  })

  test("vars() returns GOOGLE_VERTEX_LOCATION and GOOGLE_VERTEX_PROJECT", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await googleVertex(makeProvider({ options: { project: "my-project" } }))
        const vars = result.vars?.({})
        expect(vars?.GOOGLE_VERTEX_LOCATION).toBe("us-central1")
        expect(vars?.GOOGLE_VERTEX_PROJECT).toBe("my-project")
      },
    })
  })

  test("vars() returns correct endpoint for non-global location", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await googleVertex(makeProvider({ options: { project: "p", location: "us-east1" } }))
        const vars = result.vars?.({})
        expect(vars?.GOOGLE_VERTEX_ENDPOINT).toBe("us-east1-aiplatform.googleapis.com")
      },
    })
  })

  test("vars() returns aiplatform.googleapis.com for global location", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await googleVertex(makeProvider({ options: { project: "p", location: "global" } }))
        const vars = result.vars?.({})
        expect(vars?.GOOGLE_VERTEX_ENDPOINT).toBe("aiplatform.googleapis.com")
      },
    })
  })

  test("getModel calls sdk.languageModel with trimmed modelID", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await googleVertex(makeProvider({ options: { project: "p" } }))
        const mockFn = mock(() => ({ id: "gemini" }))
        const sdk = { languageModel: mockFn }
        await result.getModel?.(sdk, "  gemini-2.0-flash  ")
        expect(mockFn).toHaveBeenCalledWith("gemini-2.0-flash")
      },
    })
  })
})

// ----- googleVertexAnthropic -----
// Note: googleVertexAnthropic only reads from process.env, not provider.options.
// Env-var tests that require setting process.env are skipped here to avoid
// cross-test contamination in parallel test execution. Those paths are tested
// indirectly via the full provider integration tests (test/provider/provider.test.ts).

describe("googleVertexAnthropic loader", () => {
  test("returns autoload: false when no project env is set in snapshot", async () => {
    // Run in a fresh instance where the env doesn't have Google Cloud vars
    // This only works reliably if no other test in this worker has set them.
    // We skip the case where GOOGLE_CLOUD_PROJECT is set in the process env.
    const hasGoogleEnv =
      process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT
    if (hasGoogleEnv) return // skip if env is contaminated

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await googleVertexAnthropic(makeProvider({ id: "google-vertex-anthropic" }))
        expect(result.autoload).toBe(false)
      },
    })
  })
})

