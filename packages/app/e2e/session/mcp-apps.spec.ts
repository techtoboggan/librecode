import { expect, test } from "../fixtures"

const appsButton = 'button:has-text("Apps")'
const startMenu = 'div:has-text("Built-in")'
const activityGraphItem = 'button:has-text("Activity Graph"):has-text("Real-time")'
const sessionStatsItem = 'button:has-text("Session Stats"):has-text("Token usage")'

const mcpTab = (uri: string) => `button[role="tab"][data-value*="${uri}"]`
const mcpIframe = 'iframe[title="MCP App"]'
const mcpFailure = "text=Failed to load MCP App"

/**
 * End-to-end coverage for the two bugs uncovered in v0.9.2x:
 *
 * 1. MCP apps "TypeError: Load failed" — `mcp-app-panel.tsx` + `start-menu.tsx`
 *    were using plain `fetch()` instead of the authed wrapper. In Tauri prod
 *    the sidecar ships with LIBRECODE_SERVER_PASSWORD so every un-authed
 *    fetch got 401'd, surfacing as WebKit's "TypeError: Load failed" in the
 *    "Failed to load MCP App:" error branch.
 *
 *    The e2e stack runs against an unauthenticated sidecar, so we can't
 *    directly reproduce the 401 path here — that's covered by the unit
 *    tests in `src/context/global-sdk.test.ts`. What this spec DOES cover is
 *    the full click-through flow (popover → pin → iframe renders).
 *    Those were silently regressing prior: the popover was empty and the
 *    iframe never mounted.
 *
 * 2. `activeTab` memo fell through to `openedTabs()[0]` when the active
 *    value wasn't a file/context/apps/activity/review tab. Clicking a
 *    second pinned MCP tab snapped the UI straight back to the first
 *    pinned tab. Fixed by preserving any opened tab value that matches
 *    `openedTabs()`. This spec exercises the tab-switch directly.
 */

test.describe("MCP apps start menu", () => {
  test("opens popover, lists built-in apps, pins one, iframe renders", async ({ page, gotoSession }) => {
    await gotoSession()

    // Open the Apps start menu in the session header
    await page.locator(appsButton).click()
    await expect(page.locator(startMenu).first()).toBeVisible()
    await expect(page.locator(activityGraphItem).first()).toBeVisible()
    await expect(page.locator(sessionStatsItem).first()).toBeVisible()

    // Pin the Activity Graph — this closes the popover and adds a tab
    await page.locator(activityGraphItem).first().click()
    await expect(page.locator(startMenu).first()).toBeHidden()

    // The pinned tab mounts McpAppPanel which fetches /mcp/apps/html and
    // renders an iframe via srcdoc. Before the auth fix this path failed
    // with "Failed to load MCP App: TypeError: Load failed" against an
    // authed sidecar.
    await expect(page.locator(mcpIframe)).toBeVisible()
    await expect(page.locator(mcpFailure)).toHaveCount(0)

    const srcdoc = await page.locator(mcpIframe).getAttribute("srcdoc")
    expect(srcdoc).toBeTruthy()
    expect(srcdoc!.length).toBeGreaterThan(1000)
    expect(srcdoc).toContain("<!doctype html>")
    // CSP meta tag is injected by mcp-app-panel.tsx before rendering
    expect(srcdoc).toContain("Content-Security-Policy")
  })

  test("switching between two pinned MCP app tabs swaps the iframe", async ({ page, gotoSession }) => {
    await gotoSession()

    // Pin both built-in apps
    await page.locator(appsButton).click()
    await page.locator(activityGraphItem).first().click()
    await expect(page.locator(mcpIframe)).toBeVisible()

    await page.locator(appsButton).click()
    await page.locator(sessionStatsItem).first().click()
    await expect(page.locator(mcpIframe)).toBeVisible()

    const activityTab = page.locator(mcpTab("activity-graph")).first()
    const statsTab = page.locator(mcpTab("session-stats")).first()

    // Session Stats was the last one pinned → it's the active tab and
    // the iframe shows its HTML
    await expect(statsTab).toHaveAttribute("aria-selected", "true")
    const statsSrcdoc = await page.locator(mcpIframe).getAttribute("srcdoc")
    expect(statsSrcdoc).toBeTruthy()

    // Switch to Activity Graph. Before the activeTab memo fix, this click
    // did nothing visible: the store updated but the memo fell back to
    // openedTabs()[0] which was still session-stats — the active-tab UI
    // flickered back to session-stats.
    await activityTab.click()
    await expect(activityTab).toHaveAttribute("aria-selected", "true")
    await expect(statsTab).toHaveAttribute("aria-selected", "false")

    // The iframe must swap to the activity-graph HTML (different bytes
    // than session-stats), not stay pinned to the previously-loaded one.
    await expect.poll(async () => page.locator(mcpIframe).getAttribute("srcdoc")).not.toBe(statsSrcdoc)
    const activitySrcdoc = await page.locator(mcpIframe).getAttribute("srcdoc")
    expect(activitySrcdoc).toBeTruthy()
    expect(activitySrcdoc).not.toBe(statsSrcdoc)

    // Switch back to Session Stats — verifies the fix isn't one-directional
    await statsTab.click()
    await expect(statsTab).toHaveAttribute("aria-selected", "true")
    await expect(activityTab).toHaveAttribute("aria-selected", "false")
    await expect.poll(async () => page.locator(mcpIframe).getAttribute("srcdoc")).toBe(statsSrcdoc)
  })

  test("no 'Failed to load MCP App' error banner appears for built-in apps", async ({ page, gotoSession }) => {
    await gotoSession()

    await page.locator(appsButton).click()
    await page.locator(activityGraphItem).first().click()

    // Give the fetchAppHtml resource a chance to resolve or reject. If the
    // plain-fetch-without-auth regression returns, this assertion fires
    // because the error banner renders in place of the iframe.
    await expect(page.locator(mcpIframe)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator(mcpFailure)).toHaveCount(0)
  })
})
