/**
 * Tests for the ui/download-file handler added in v0.9.43.
 *
 * Confirms the contract per ADR-005 §6: every download batch needs
 * explicit user consent; unsafe schemes (anything outside http/https)
 * are rejected outright; failures resolve to in-band {isError: true}
 * so the bridge stays alive.
 */
import { describe, expect, mock, test } from "bun:test"
import {
  type DownloadItem,
  createDownloadHandler,
  downloadItemFilename,
  embeddedResourceToBlob,
  isSafeDownloadUrl,
} from "./mcp-app-download"

describe("downloadItemFilename", () => {
  test("uses the explicit `name` on a ResourceLink when present", () => {
    const item: DownloadItem = { type: "resource_link", uri: "https://example.com/a.pdf", name: "report.pdf" }
    expect(downloadItemFilename(item)).toBe("report.pdf")
  })

  test("falls back to the URL basename for ResourceLink without name", () => {
    const item: DownloadItem = { type: "resource_link", uri: "https://example.com/path/file.txt?v=1" }
    expect(downloadItemFilename(item)).toBe("file.txt")
  })

  test("uses the resource URI basename for EmbeddedResource", () => {
    const item: DownloadItem = { type: "resource", resource: { uri: "lctest://docs/readme.md", text: "..." } }
    expect(downloadItemFilename(item)).toBe("readme.md")
  })

  test("falls back to 'download' when no basename can be extracted", () => {
    const item: DownloadItem = { type: "resource_link", uri: "https://example.com/" }
    expect(downloadItemFilename(item)).toBe("download")
  })
})

describe("isSafeDownloadUrl", () => {
  test("matches the open-link allowlist (http + https only)", () => {
    expect(isSafeDownloadUrl("https://example.com")).toBe(true)
    expect(isSafeDownloadUrl("http://example.com")).toBe(true)
    expect(isSafeDownloadUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeDownloadUrl("file:///etc/passwd")).toBe(false)
    expect(isSafeDownloadUrl("data:text/html,<script>")).toBe(false)
  })
})

describe("embeddedResourceToBlob", () => {
  test("builds a Blob from text content using the supplied mimeType", async () => {
    const blob = embeddedResourceToBlob({ mimeType: "text/plain", text: "hello" })
    expect(blob).toBeDefined()
    expect(blob?.type).toBe("text/plain")
    expect(await blob?.text()).toBe("hello")
  })

  test("decodes base64 blob content", async () => {
    const base64 = btoa("binary-bytes")
    const blob = embeddedResourceToBlob({ mimeType: "application/octet-stream", blob: base64 })
    expect(blob).toBeDefined()
    expect(await blob?.text()).toBe("binary-bytes")
  })

  test("returns undefined when neither text nor blob is supplied", () => {
    expect(embeddedResourceToBlob({ mimeType: "text/plain" })).toBeUndefined()
  })

  test("returns undefined on malformed base64 instead of throwing", () => {
    expect(embeddedResourceToBlob({ mimeType: "text/plain", blob: "not-base64-!!!@" })).toBeUndefined()
  })

  test("defaults mimeType to application/octet-stream", () => {
    const blob = embeddedResourceToBlob({ text: "hi" })
    expect(blob?.type).toBe("application/octet-stream")
  })
})

describe("createDownloadHandler", () => {
  function setup(overrides?: { confirm?: ReturnType<typeof mock> }) {
    const confirm = overrides?.confirm ?? mock(async () => true)
    const deliverBlob = mock<(blob: Blob, filename: string) => void>()
    const openUrl = mock<(url: string) => void>()
    const handler = createDownloadHandler({ confirm, deliverBlob, openUrl })
    return { handler, confirm, deliverBlob, openUrl }
  }

  test("empty contents → isError, no confirm", async () => {
    const { handler, confirm } = setup()
    const result = await handler({ contents: [] })
    expect(confirm).toHaveBeenCalledTimes(0)
    expect(result.isError).toBe(true)
  })

  test("user cancels → isError, nothing delivered", async () => {
    const { handler, deliverBlob, openUrl } = setup({ confirm: mock(async () => false) })
    const result = await handler({
      contents: [{ type: "resource", resource: { uri: "lctest://x", text: "x" } }],
    })
    expect(deliverBlob).toHaveBeenCalledTimes(0)
    expect(openUrl).toHaveBeenCalledTimes(0)
    expect(result.isError).toBe(true)
  })

  test("unsafe scheme on any item aborts the whole batch BEFORE asking the user", async () => {
    // Per ADR-005: javascript:/data:/file:/blob: are silently rejected.
    // The user shouldn't even be presented with the option.
    const { handler, confirm } = setup()
    const result = await handler({
      contents: [
        { type: "resource", resource: { uri: "lctest://safe.txt", text: "ok" } },
        { type: "resource_link", uri: "javascript:alert(1)" },
      ],
    })
    expect(confirm).toHaveBeenCalledTimes(0)
    expect(result.isError).toBe(true)
  })

  test("happy path: confirm + deliver each item", async () => {
    const { handler, confirm, deliverBlob, openUrl } = setup()
    const items: DownloadItem[] = [
      { type: "resource", resource: { uri: "lctest://readme.md", mimeType: "text/markdown", text: "# hi" } },
      { type: "resource_link", uri: "https://example.com/report.pdf", name: "report.pdf" },
    ]
    const result = await handler({ contents: items })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(deliverBlob).toHaveBeenCalledTimes(1)
    expect(deliverBlob.mock.calls[0][1]).toBe("readme.md")
    expect(openUrl).toHaveBeenCalledTimes(1)
    expect(openUrl.mock.calls[0][0]).toBe("https://example.com/report.pdf")
    expect(result.isError).toBeUndefined()
  })

  test("EmbeddedResource without text or blob → reported as isError", async () => {
    const { handler } = setup()
    const result = await handler({
      contents: [{ type: "resource", resource: { uri: "lctest://empty", mimeType: "text/plain" } }],
    })
    expect(result.isError).toBe(true)
  })

  test("delivery throw on one item still attempts the rest, marks isError", async () => {
    const deliverBlob = mock<(blob: Blob, filename: string) => void>(() => {
      throw new Error("disk full")
    })
    const openUrl = mock<(url: string) => void>()
    const handler = createDownloadHandler({ confirm: async () => true, deliverBlob, openUrl })
    const result = await handler({
      contents: [
        { type: "resource", resource: { uri: "lctest://a.txt", text: "a" } },
        { type: "resource_link", uri: "https://example.com/b.pdf" },
      ],
    })
    expect(deliverBlob).toHaveBeenCalledTimes(1)
    expect(openUrl).toHaveBeenCalledTimes(1)
    expect(result.isError).toBe(true)
  })
})
