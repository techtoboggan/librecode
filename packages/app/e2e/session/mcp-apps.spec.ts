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

  test("switching between two pinned MCP app tabs flips aria-selected", async ({ page, gotoSession }) => {
    await gotoSession()

    // Pin both built-in apps. After each pin the app becomes active and its
    // iframe becomes visible — wait on count reaching 1 then 2 (with
    // forceMount both iframes persist in the DOM).
    await page.locator(appsButton).click()
    await page.locator(activityGraphItem).first().click()
    await expect(page.locator(mcpIframe)).toHaveCount(1)

    await page.locator(appsButton).click()
    await page.locator(sessionStatsItem).first().click()
    await expect(page.locator(mcpIframe)).toHaveCount(2)

    // With forceMount both iframes stay in the DOM. Filter to the visible
    // tab buttons to avoid the zero-width kobalte roving duplicates.
    const activityTab = page.locator('button[role="tab"][data-value*="activity-graph"]').first()
    const statsTab = page.locator('button[role="tab"][data-value*="session-stats"]').first()

    // Session Stats was last pinned → it's the active tab
    await expect(statsTab).toHaveAttribute("aria-selected", "true")
    await expect(activityTab).toHaveAttribute("aria-selected", "false")

    // Switch to Activity Graph. Before the activeTab memo fix, this click
    // did nothing visible: the store updated but the memo fell back to
    // openedTabs()[0] which was still session-stats — the active-tab UI
    // flickered back to session-stats.
    await activityTab.click()
    await expect(activityTab).toHaveAttribute("aria-selected", "true")
    await expect(statsTab).toHaveAttribute("aria-selected", "false")

    // Switch back — not one-directional
    await statsTab.click()
    await expect(statsTab).toHaveAttribute("aria-selected", "true")
    await expect(activityTab).toHaveAttribute("aria-selected", "false")
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

  test("pinning an MCP app does not force the review panel open", async ({ page, gotoSession }) => {
    await gotoSession()

    const toggleReview = page.locator('button[aria-label="Toggle review"]')

    // Close the review panel if it's open
    if ((await toggleReview.getAttribute("aria-expanded")) === "true") {
      await toggleReview.click()
      await expect(toggleReview).toHaveAttribute("aria-expanded", "false")
    }

    // Pin an app — previously this yanked the review panel open without
    // asking, trashing whatever layout the user had set up.
    await page.locator(appsButton).click()
    await page.locator(activityGraphItem).first().click()

    // Panel must still be closed. User has to click Toggle review to see it.
    await expect(toggleReview).toHaveAttribute("aria-expanded", "false")
  })

  test("no duplicate pinned MCP tabs (SortableTab skips non-file tabs)", async ({ page, gotoSession }) => {
    await gotoSession()

    // Pin both built-in apps
    await page.locator(appsButton).click()
    await page.locator(activityGraphItem).first().click()
    await page.locator(appsButton).click()
    await page.locator(sessionStatsItem).first().click()

    // Open the review panel so the tabs row is visible
    const toggleReview = page.locator('button[aria-label="Toggle review"]')
    if ((await toggleReview.getAttribute("aria-expanded")) !== "true") {
      await toggleReview.click()
    }

    // Count VISIBLE mcp-app tab triggers — before the SortableTab-filter
    // fix, each pinned app rendered twice (once by the dedicated For loop,
    // once by the sortable file-tabs For loop) producing duplicate tabs and
    // two X buttons per app.
    const mcpTabs = page.locator('button[role="tab"][data-value^="mcp-app:"]')
    const visibleTabs = await mcpTabs.evaluateAll(
      (els) =>
        els.filter((el) => (el as HTMLElement).offsetParent !== null && el.getBoundingClientRect().width > 10).length,
    )
    expect(visibleTabs).toBe(2)

    // And exactly one close button per app
    expect(await page.locator('button[aria-label^="Unpin "]').count()).toBe(2)
  })

  test("tab switch is instant — iframes persist, no re-fetch", async ({ page, gotoSession }) => {
    await gotoSession()

    await page.locator(appsButton).click()
    await page.locator(activityGraphItem).first().click()
    await page.locator(appsButton).click()
    await page.locator(sessionStatsItem).first().click()

    const toggleReview = page.locator('button[aria-label="Toggle review"]')
    if ((await toggleReview.getAttribute("aria-expanded")) !== "true") {
      await toggleReview.click()
    }

    // With forceMount, BOTH iframes are mounted in the DOM even though only
    // one is visible. Without it, Kobalte unmounts the inactive panel and
    // mounting+refetching on every switch produces the "screen refresh"
    // flicker the user reported.
    await expect(page.locator(mcpIframe)).toHaveCount(2, { timeout: 10_000 })

    const activityTab = page.locator(mcpTab("activity-graph")).first()
    const statsTab = page.locator(mcpTab("session-stats")).first()

    // Switch back and forth — both iframes should remain in the DOM the
    // whole time.
    await activityTab.click()
    await expect(page.locator(mcpIframe)).toHaveCount(2)
    await statsTab.click()
    await expect(page.locator(mcpIframe)).toHaveCount(2)
  })

  test("host theme tokens are injected into the iframe srcdoc", async ({ page, gotoSession }) => {
    await gotoSession()

    await page.locator(appsButton).click()
    await page.locator(activityGraphItem).first().click()
    await expect(page.locator(mcpIframe)).toBeVisible()

    // Verify the theme <style> block was injected with the host's computed
    // --background-base / --text-base values. Without this, the built-in
    // apps use their hardcoded dark colors and clash with the host theme.
    const srcdoc = (await page.locator(mcpIframe).getAttribute("srcdoc")) ?? ""
    expect(srcdoc).toContain("--lc-bg:")
    expect(srcdoc).toContain("--lc-text:")
    expect(srcdoc).toContain("color-scheme: light dark")
  })
})
