/**
 * Phase 36B — gate guard for the MCP integration tests.
 *
 * These tests spawn a real MCP server subprocess via `StdioClientTransport`.
 * Sibling tests under `test/mcp/` use `mock.module(...)` to stub the SDK's
 * transport modules — and bun's `mock.module()` mutates the module registry
 * for the entire test process (`mock.restore()` doesn't unwind it). When
 * `bun test` (no script) runs both directories in one invocation, the
 * integration tests inherit the stubs and fail.
 *
 * The fix is process isolation: `package.json` already runs them via a
 * separate `bun test` invocation under `test:integration`. To avoid
 * confusing contributors who run `bun test` directly and see 3 spurious
 * failures, the integration test scripts set `LIBRECODE_RUN_INTEGRATION=1`
 * — and these `describe(...)` blocks skip themselves when that flag is
 * absent. So `bun test` shows them as skipped (clear), and
 * `bun run test:integration` runs them for real.
 */
export const SHOULD_RUN_INTEGRATION = process.env.LIBRECODE_RUN_INTEGRATION === "1"

export const SKIP_REASON = "set LIBRECODE_RUN_INTEGRATION=1 (or use `bun run test:integration`) to run"
