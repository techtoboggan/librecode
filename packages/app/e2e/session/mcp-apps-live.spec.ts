import { expect, test } from "../fixtures"

const appsButton = 'button:has-text("Apps")'
const sessionStatsItem = 'button:has-text("Session Stats"):has-text("Token usage")'
const activityGraphItem = 'button:has-text("Activity Graph"):has-text("Real-time")'
const mcpTab = (uri: string) => `button[role="tab"][data-value*="${uri}"]`
const mcpIframe = 'iframe[title="MCP App"]'

/**
 * End-to-end validation that SSE events delivered via the global SDK emitter
 * reach the MCP app iframes. A real tool-run backend would take minutes to
 * provision in e2e — we flip on the `__librecode_e2e.eventBus` probe so the
 * spec can push a synthetic `message.part.updated` through the exact same
 * emitter the SSE stream feeds, exercising the full forwarder → iframe
 * postMessage path.
 */
test.describe("MCP apps — live event forwarding", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const win = window as typeof window & {
        __librecode_e2e?: { eventBus?: { enabled: boolean } }
      }
      win.__librecode_e2e = { ...win.__librecode_e2e, eventBus: { enabled: true } }
    })
  })

  test("message.part.updated tool events bump Session Stats tool counts", async ({ page, gotoSession }) => {
    await gotoSession()

    await page.locator(appsButton).click()
    await page.locator(sessionStatsItem).first().click()

    await expect(page.locator(mcpTab("session-stats")).first()).toHaveAttribute("aria-selected", "true")
    await expect(page.locator(mcpIframe)).toHaveCount(1)

    // Wait for the iframe's inner script to have installed its message
    // listener and posted mcp-app-ready. Without this, our synthetic events
    // can land before the listener is attached and just get dropped.
    const statsFrame = page.frameLocator(mcpTab("session-stats").replace("button", "iframe"))
    // The iframe selector uses title attr — use the generic mcpIframe.
    const frame = page.frameLocator(mcpIframe)
    await expect(frame.locator("#empty, #stats")).toBeVisible()

    // Push two `message.part.updated` events with tool parts. The iframe
    // script at session-stats.html increments `toolCounts[part.tool]` for
    // each tool-type part received.
    const directory = await page.evaluate(() => {
      // Directory comes from the session URL's base64 path segment; the
      // app's SDK context will be tied to that directory.
      return document.location.pathname.split("/")[1] ?? ""
    })

    await page.evaluate(
      ({ dir }) => {
        const w = window as typeof window & {
          __librecode_e2e?: {
            eventBus?: { emit?: (d: string, p: { type: string } & Record<string, unknown>) => void }
          }
        }
        const emit = w.__librecode_e2e?.eventBus?.emit
        if (!emit) throw new Error("eventBus probe not wired — check GlobalSDKProvider")
        emit(dir, {
          type: "message.part.updated",
          properties: {
            part: { id: "p1", messageID: "m1", type: "tool", tool: "read", state: { status: "completed", input: {} } },
          },
        })
        emit(dir, {
          type: "message.part.updated",
          properties: {
            part: { id: "p2", messageID: "m1", type: "tool", tool: "read", state: { status: "completed", input: {} } },
          },
        })
        emit(dir, {
          type: "message.part.updated",
          properties: {
            part: { id: "p3", messageID: "m1", type: "tool", tool: "bash", state: { status: "completed", input: {} } },
          },
        })
      },
      { dir: directory },
    )

    // session-stats renders a bar chart row per tool. After our 3 synthetic
    // events we should see "read" (count 2) and "bash" (count 1).
    const readRow = frame.locator(".bar-row", { hasText: "read" })
    const bashRow = frame.locator(".bar-row", { hasText: "bash" })

    await expect(readRow).toBeVisible()
    await expect(bashRow).toBeVisible()
    await expect(readRow.locator(".bar-count")).toHaveText("2")
    await expect(bashRow.locator(".bar-count")).toHaveText("1")

    // Silence unused-warn for statsFrame by asserting it resolves to the
    // same iframe — keeps the locator API usage readable above.
    expect(statsFrame).toBeDefined()
  })

  test("activity.updated drives the Activity Graph header state", async ({ page, gotoSession }) => {
    await gotoSession()

    await page.locator(appsButton).click()
    await page.locator(activityGraphItem).first().click()

    await expect(page.locator(mcpTab("activity-graph")).first()).toHaveAttribute("aria-selected", "true")
    const frame = page.frameLocator(mcpIframe)
    // Wait for the iframe to have rendered its header.
    await expect(frame.locator("#status-label")).toBeVisible()
    await expect(frame.locator("#status-label")).toHaveText(/Waiting for activity/i)

    const directory = await page.evaluate(() => document.location.pathname.split("/")[1] ?? "")

    await page.evaluate(
      ({ dir }) => {
        const emit = (
          window as typeof window & {
            __librecode_e2e?: { eventBus?: { emit?: (d: string, p: unknown) => void } }
          }
        ).__librecode_e2e?.eventBus?.emit
        if (!emit) throw new Error("eventBus probe not wired")
        emit(dir, {
          type: "activity.updated",
          properties: {
            sessionID: "ses_test",
            files: {
              "src/a.ts": { path: "src/a.ts", kind: "read", updatedAt: Date.now() },
              "src/b.ts": { path: "src/b.ts", kind: "write", updatedAt: Date.now() },
            },
            agents: {
              main: { agentID: "main", phase: "executing", updatedAt: Date.now() },
            },
            updatedAt: Date.now(),
          },
        })
      },
      { dir: directory },
    )

    // The iframe's inline script updates these three DOM bits off every
    // activity.updated event.
    await expect(frame.locator("#status-dot")).toHaveClass(/active/)
    await expect(frame.locator("#status-label")).toHaveText("executing")
    await expect(frame.locator("#file-count")).toHaveText("2 files")
  })
})
