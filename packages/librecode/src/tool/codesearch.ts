import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./codesearch.txt"
import { abortAfterAny } from "../util/abort"

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    CONTEXT: "/mcp",
  },
} as const

interface McpCodeRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      tokensNum: number
    }
  }
}

interface McpCodeResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

function parseSseText(responseText: string): string | undefined {
  for (const line of responseText.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data: McpCodeResponse = JSON.parse(line.substring(6))
    if (data.result?.content?.length > 0) return data.result.content[0].text
  }
  return undefined
}

async function fetchCodeSearchResponse(request: McpCodeRequest, signal: AbortSignal): Promise<string> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  }
  const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Code search error (${response.status}): ${errorText}`)
  }
  return response.text()
}

export const CodeSearchTool = Tool.define("codesearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z
      .string()
      .describe(
        "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
      ),
    tokensNum: z
      .number()
      .min(1000)
      .max(50000)
      .default(5000)
      .describe(
        "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
      ),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "codesearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        tokensNum: params.tokensNum,
      },
    })

    const codeRequest: McpCodeRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_code_context_exa",
        arguments: {
          query: params.query,
          tokensNum: params.tokensNum || 5000,
        },
      },
    }

    const { signal, clearTimeout } = abortAfterAny(30000, ctx.abort)

    try {
      const responseText = await fetchCodeSearchResponse(codeRequest, signal)
      clearTimeout()

      const output = parseSseText(responseText)
      if (output) {
        return { output, title: `Code search: ${params.query}`, metadata: {} }
      }

      return {
        output:
          "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
        title: `Code search: ${params.query}`,
        metadata: {},
      }
    } catch (error) {
      clearTimeout()
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Code search request timed out")
      }
      throw error
    }
  },
})
