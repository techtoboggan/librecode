/**
 * Pure helpers for the `ui/download-file` AppBridge handler. Lives in its
 * own file so the test suite can import them without dragging in the
 * Solid + Kobalte + router dependencies pulled in by mcp-app-panel.tsx.
 *
 * Contracts (per ADR-005 §6 + the v0.9.43 implementation):
 *   - Every download batch needs explicit user consent (caller-injected).
 *   - ResourceLink URIs that aren't http/https are rejected before the
 *     user is even asked.
 *   - Failures resolve to {isError: true} — the handler never throws,
 *     so the AppBridge stays alive for the next call.
 */

/** Same allowlist as ui/open-link — http and https only. */
export const DOWNLOAD_ALLOWED_SCHEMES = new Set(["http:", "https:"])

/**
 * Shape of items inside `ui/download-file` request params per MCP spec.
 *
 * `EmbeddedResource` carries inline bytes (text or base64 blob);
 * `ResourceLink` carries a URI the host can fetch or open.
 */
export type DownloadItem =
  | {
      type: "resource"
      resource: { uri: string; mimeType?: string; text?: string; blob?: string }
    }
  | { type: "resource_link"; uri: string; name?: string; mimeType?: string }

/** Pure: extract a sane filename from any download item. Falls back to "download". */
export function downloadItemFilename(item: DownloadItem): string {
  if (item.type === "resource_link") {
    if (item.name) return item.name
    const tail = item.uri.split(/[?#]/)[0].split("/").pop()
    return tail || "download"
  }
  const tail = item.resource.uri.split(/[?#]/)[0].split("/").pop()
  return tail || "download"
}

/** Pure: validate a ResourceLink URL against the http/https allowlist. */
export function isSafeDownloadUrl(url: string): boolean {
  try {
    return DOWNLOAD_ALLOWED_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * Pure: convert an EmbeddedResource to a Blob the host can hand to the
 * browser. Defers to text content first, then base64 blob. Returns
 * undefined if neither is present (or the base64 decode fails).
 */
export function embeddedResourceToBlob(resource: {
  mimeType?: string
  text?: string
  blob?: string
}): Blob | undefined {
  const mimeType = resource.mimeType ?? "application/octet-stream"
  if (resource.text != null) return new Blob([resource.text], { type: mimeType })
  if (resource.blob != null) {
    try {
      const binary = atob(resource.blob)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return new Blob([bytes], { type: mimeType })
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Build the AppBridge `ondownloadfile` handler. Confirm-then-deliver
 * with full failure tolerance.
 */
export function createDownloadHandler(deps: {
  /** Confirm with the user. Resolves true on approval, false on cancel. */
  confirm: (items: DownloadItem[]) => Promise<boolean>
  /** Deliver an inline blob to disk. */
  deliverBlob: (blob: Blob, filename: string) => void
  /** Open a remote URL in a new tab/browser. */
  openUrl: (url: string) => void
}) {
  return async (params: { contents: DownloadItem[] }) => {
    const items = params.contents ?? []
    if (items.length === 0) return { isError: true }

    // Pre-flight: any unsafe ResourceLink scheme aborts the whole batch
    // before the user is even asked.
    for (const item of items) {
      if (item.type === "resource_link" && !isSafeDownloadUrl(item.uri)) {
        return { isError: true }
      }
    }

    const approved = await deps.confirm(items)
    if (!approved) return { isError: true }

    let failed = false
    for (const item of items) {
      if (item.type === "resource_link") {
        try {
          deps.openUrl(item.uri)
        } catch {
          failed = true
        }
        continue
      }
      const blob = embeddedResourceToBlob(item.resource)
      if (!blob) {
        failed = true
        continue
      }
      try {
        deps.deliverBlob(blob, downloadItemFilename(item))
      } catch {
        failed = true
      }
    }
    return failed ? { isError: true } : {}
  }
}

/**
 * Default DOM-side delivery: makes an object URL, builds an anchor with
 * `download="<name>"`, clicks it, then revokes the URL on the next tick.
 * Browser-only — used by the production hook, not tests.
 */
export function deliverBlobAsDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
