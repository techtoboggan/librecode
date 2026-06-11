/**
 * Gate for script/e2e-tauri-real.sh: block until the Tauri app's webview is
 * actually DRIVEABLE over the plugin socket, not merely until the socket file
 * exists. The plugin opens its socket slightly before the main window is
 * registered, so a Playwright run started on socket-existence can race it —
 * the first fixture eval fails with "window 'main' not found after retries"
 * (observed intermittently locally and on cold CI runners).
 *
 * Probes `{type:"eval"}` round-trips until one succeeds. Runs under bun or
 * node. Usage: bun e2e/scripts/wait-tauri-ready.mjs [timeoutSeconds]
 */

import { PluginClient } from "@srsholmes/tauri-playwright"

const sock = process.env.TAURI_PLAYWRIGHT_SOCKET ?? "/tmp/tauri-playwright.sock"
const timeoutS = Number(process.argv[2] ?? 120)
const deadline = Date.now() + timeoutS * 1000

let lastError = ""
while (Date.now() < deadline) {
  const client = new PluginClient(sock)
  try {
    await client.connect()
    const resp = await client.send({ type: "eval", script: "1+1" })
    if (resp.ok) {
      console.log("tauri webview driveable")
      client.disconnect()
      process.exit(0)
    }
    lastError = resp.error ?? "not ok"
  } catch (err) {
    lastError = String(err)
  }
  try {
    client.disconnect()
  } catch {}
  await new Promise((r) => setTimeout(r, 1000))
}
console.error(`tauri webview not driveable within ${timeoutS}s (last: ${lastError})`)
process.exit(1)
