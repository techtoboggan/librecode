#!/usr/bin/env bun
/**
 * v0.9.76 — Multica MCP app entry point.
 *
 * Boots the MCP server over stdio with config from environment
 * variables. Exit codes:
 *   - 0 on clean shutdown
 *   - 1 when required config is missing (printed on stderr)
 *   - 2 on any other startup failure
 */
import { loadConfigFromEnv, runStdio } from "./mcp/server"

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfigFromEnv>
  try {
    config = loadConfigFromEnv()
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }

  try {
    await runStdio(config)
  } catch (err) {
    process.stderr.write(`Multica MCP app: fatal startup error\n${err instanceof Error ? err.stack : String(err)}\n`)
    process.exit(2)
  }
}

main()
