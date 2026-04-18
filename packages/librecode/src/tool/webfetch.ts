import TurndownService from "turndown"
import z from "zod"
import { abortAfterAny } from "../util/abort"
import { validateFetchURL } from "../util/ssrf"
import { Tool } from "./tool"
import DESCRIPTION from "./webfetch.txt"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    // A10 (SSRF) — validate scheme, hostname, resolved IP before ever
    // asking for permission. The user approving `webfetch` at the UI
    // level sees the URL string; they cannot be expected to know that
    // `metadata.google.internal` or `169.254.169.254` would leak cloud
    // credentials. Reject those at the edge regardless of approval.
    await validateFetchURL(params.url)

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: {
        url: params.url,
        format: params.format,
        timeout: params.timeout,
      },
    })

    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)
    const { signal, clearTimeout } = abortAfterAny(timeout, ctx.abort)
    const headers = buildFetchHeaders(params.format)
    const response = await fetchWithCloudflareRetry(params.url, signal, headers)
    clearTimeout()

    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`)
    }

    const arrayBuffer = await readResponseBody(response)
    const contentType = response.headers.get("content-type") || ""
    const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
    const title = `${params.url} (${contentType})`
    const isImage = mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"

    if (isImage) {
      const base64Content = Buffer.from(arrayBuffer).toString("base64")
      return {
        title,
        output: "Image fetched successfully",
        metadata: {},
        attachments: [{ type: "file", mime, url: `data:${mime};base64,${base64Content}` }],
      }
    }

    const content = new TextDecoder().decode(arrayBuffer)
    return formatResponse(content, contentType, params.format, title)
  },
})

function buildAcceptHeader(format: "markdown" | "text" | "html" | string): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
    default:
      return "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
  }
}

function buildFetchHeaders(format: string): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    Accept: buildAcceptHeader(format),
    "Accept-Language": "en-US,en;q=0.9",
  }
}

async function fetchWithCloudflareRetry(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string>,
): Promise<Response> {
  const initial = await fetch(url, { signal, headers })
  if (initial.status === 403 && initial.headers.get("cf-mitigated") === "challenge") {
    return fetch(url, { signal, headers: { ...headers, "User-Agent": "librecode" } })
  }
  return initial
}

async function readResponseBody(response: Response): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("content-length")
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
    throw new Error("Response too large (exceeds 5MB limit)")
  }
  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
    throw new Error("Response too large (exceeds 5MB limit)")
  }
  return arrayBuffer
}

async function formatResponse(
  content: string,
  contentType: string,
  format: string,
  title: string,
): Promise<{ output: string; title: string; metadata: Record<string, never> }> {
  if (format === "markdown" && contentType.includes("text/html")) {
    return { output: convertHTMLToMarkdown(content), title, metadata: {} }
  }
  if (format === "text" && contentType.includes("text/html")) {
    return { output: await extractTextFromHTML(content), title, metadata: {} }
  }
  return { output: content, title, metadata: {} }
}

async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
