import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "../fixtures"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_SCRIPT = path.resolve(
  HERE,
  "..",
  "..",
  "..",
  "librecode",
  "test",
  "fixtures",
  "mcp-apps",
  "test-app-server.ts",
)

const MARKER = "LIBRECODE_TEST_APP_MARKER_8b3f"
const SERVER_NAME = "lc-test-app"
const APP_NAME = "test-hello-app"
const TEST_APP_URI = "ui://lc-test/hello"

const appsButton = 'button:has-text("Apps")'
const mcpIframe = 'iframe[title="MCP App"]'

/**
 * Track 2.3 — proves the full external-MCP-app stack works end-to-end:
 * a user-supplied MCP server (here, our `test-app-server.ts` fixture)
 * registers a `ui://` resource, the host's /mcp/apps endpoint surfaces
 * it through the start menu, the user pins it, and the iframe renders
 * the server's HTML verbatim.
 *
 * The fixture is the same one Track 2.2 unit-tested at the MCP module
 * layer; here we exercise it through the live web stack.
 */
test.describe("MCP apps — external server end-to-end", () => {
  test("third-party ui:// resource lists in Apps menu and renders in iframe", async ({ page, withProject }) => {
    await withProject(
      async ({ gotoSession }) => {
        await gotoSession()

        // Open the Apps start menu — give the MCP server time to spawn,
        // connect, and have its resources surfaced.
        await page.locator(appsButton).click()

        const item = page
          .locator("button", { hasText: APP_NAME })
          .filter({ has: page.locator(`text=${SERVER_NAME}`) })
          .first()
        await expect(item).toBeVisible({ timeout: 30_000 })

        await item.click()

        // The pinned tab should appear and the iframe should render the
        // fixture's HTML — assert against the marker baked into the
        // fixture so we know we got real bytes from the MCP server.
        await expect(page.locator(`button[role="tab"][data-value*="${encodeURIComponent(TEST_APP_URI)}"]`)).toHaveCount(
          1,
          { timeout: 10_000 },
        )

        const frame = page.frameLocator(mcpIframe)
        await expect(frame.locator(`#${MARKER}`)).toBeVisible({ timeout: 10_000 })
        await expect(frame.locator(`#${MARKER}`)).toContainText(MARKER)
      },
      {
        extraConfig: {
          mcp: {
            [SERVER_NAME]: {
              type: "local",
              command: ["bun", FIXTURE_SCRIPT],
            },
          },
        },
      },
    )
  })
})
