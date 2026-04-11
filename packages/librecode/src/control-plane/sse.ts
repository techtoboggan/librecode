type SseState = { last: string; retry: number }

function parseSseLine(line: string, data: string[], state: SseState): void {
  if (line.startsWith("data:")) {
    data.push(line.replace(/^data:\s*/, ""))
    return
  }
  if (line.startsWith("id:")) {
    state.last = line.replace(/^id:\s*/, "")
    return
  }
  if (line.startsWith("retry:")) {
    const parsed = Number.parseInt(line.replace(/^retry:\s*/, ""), 10)
    if (!Number.isNaN(parsed)) state.retry = parsed
  }
}

function dispatchSseChunk(chunk: string, state: SseState, onEvent: (event: unknown) => void): void {
  const data: string[] = []
  for (const line of chunk.split("\n")) {
    parseSseLine(line, data, state)
  }
  if (!data.length) return
  const raw = data.join("\n")
  try {
    onEvent(JSON.parse(raw))
  } catch {
    onEvent({
      type: "sse.message",
      properties: {
        data: raw,
        id: state.last || undefined,
        retry: state.retry,
      },
    })
  }
}

export async function parseSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  const state: SseState = { last: "", retry: 1000 }

  const abort = () => {
    void reader.cancel().catch(() => undefined)
  }

  signal.addEventListener("abort", abort)

  try {
    while (!signal.aborted) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined as Uint8Array | undefined }))
      if (chunk.done) break

      buf += decoder.decode(chunk.value, { stream: true })
      buf = buf.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

      const chunks = buf.split("\n\n")
      buf = chunks.pop() ?? ""

      for (const c of chunks) {
        dispatchSseChunk(c, state, onEvent)
      }
    }
  } finally {
    signal.removeEventListener("abort", abort)
    reader.releaseLock()
  }
}
