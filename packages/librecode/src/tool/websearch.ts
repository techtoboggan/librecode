import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { abortAfterAny } from "../util/abort"

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    SEARCH: "/mcp",
  },
  DEFAULT_NUM_RESULTS: 8,
} as const

interface McpSearchRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      numResults?: number
      livecrawl?: "fallback" | "preferred"
      type?: "auto" | "fast" | "deep"
      contextMaxCharacters?: number
    }
  }
}

interface McpSearchResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

function buildSearchRequest(params: {
  query: string
  numResults?: number
  livecrawl?: "fallback" | "preferred"
  type?: "auto" | "fast" | "deep"
  contextMaxCharacters?: number
}): McpSearchRequest {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "web_search_exa",
      arguments: {
        query: params.query,
        type: params.type || "auto",
        numResults: params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
        livecrawl: params.livecrawl || "fallback",
        contextMaxCharacters: params.contextMaxCharacters,
      },
    },
  }
}

function parseSseResult(responseText: string): string | undefined {
  for (const line of responseText.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data: McpSearchResponse = JSON.parse(line.substring(6))
    if (data.result?.content?.length > 0) {
      return data.result.content[0].text
    }
  }
  return undefined
}

async function executeSearchRequest(request: McpSearchRequest, signal: AbortSignal): Promise<string | undefined> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  }
  const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Search error (${response.status}): ${errorText}`)
  }
  return parseSseResult(await response.text())
}

export const WebSearchTool = Tool.define("websearch", async () => {
  return {
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: z.object({
      query: z.string().describe("Websearch query"),
      numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
      livecrawl: z
        .enum(["fallback", "preferred"])
        .optional()
        .describe(
          "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
        ),
      type: z
        .enum(["auto", "fast", "deep"])
        .optional()
        .describe(
          "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
        ),
      contextMaxCharacters: z
        .number()
        .optional()
        .describe("Maximum characters for context string optimized for LLMs (default: 10000)"),
    }),
    async execute(params, ctx) {
      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: {
          query: params.query,
          numResults: params.numResults,
          livecrawl: params.livecrawl,
          type: params.type,
          contextMaxCharacters: params.contextMaxCharacters,
        },
      })

      const searchRequest = buildSearchRequest(params)
      const { signal, clearTimeout } = abortAfterAny(25000, ctx.abort)

      try {
        const result = await executeSearchRequest(searchRequest, signal)
        clearTimeout()
        return {
          output: result ?? "No search results found. Please try a different query.",
          title: `Web search: ${params.query}`,
          metadata: {},
        }
      } catch (error) {
        clearTimeout()
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Search request timed out")
        }
        throw error
      }
    },
  }
})
