/**
 * v0.9.76 — Phoenix Arize telemetry pipeline.
 *
 * Wires LibreCode's existing OpenTelemetry-shaped LLM spans (the AI
 * SDK already emits OTel spans when `experimental_telemetry` is on)
 * to a user-controlled Phoenix instance:
 *
 *   AI-SDK call → OTel span → OpenInferenceSimpleSpanProcessor (rewrites attrs
 *   → OTLPTraceExporter (HTTP/protobuf) → Phoenix at http://<host>:6006/v1/traces
 *
 * Why OpenInference rewriting: Phoenix renders generic OTel spans
 * fine, but its LLM-specific UI (prompt/response side-by-side, eval
 * scoring, token-cost rollups) keys off the OpenInference semantic
 * conventions (`llm.input_messages.{i}.message.{role,content}`,
 * `llm.token_count.*`, `openinference.span.kind=LLM`). The
 * `@arizeai/openinference-vercel` adapter translates the AI SDK's
 * standard `gen_ai.*` attributes into that shape automatically.
 *
 * The user runs the Phoenix daemon themselves
 * (`pip install arize-phoenix && phoenix serve` or
 * `docker run -p 6006:6006 arizephoenix/phoenix`). This module just
 * (a) checks whether Phoenix is reachable, and (b) ships spans to it.
 */
import { OpenInferenceSimpleSpanProcessor, isOpenInferenceSpan } from "@arizeai/openinference-vercel"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { BatchSpanProcessor, NodeTracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace-node"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import { Log } from "../util/log"

const log = Log.create({ service: "telemetry.phoenix" })

export const DEFAULT_PHOENIX_ENDPOINT = "http://localhost:6006/v1/traces"
export const DEFAULT_PHOENIX_PROJECT = "librecode"

export interface PhoenixConfig {
  enabled: boolean
  /** OTLP/HTTP endpoint, e.g. `http://localhost:6006/v1/traces`. */
  endpoint?: string
  /** Project name shown in Phoenix's UI sidebar. */
  projectName?: string
  /** Optional API key for hosted Phoenix (`PHOENIX_API_KEY`). Self-hosted ignores it. */
  apiKey?: string
}

interface RuntimeState {
  provider: NodeTracerProvider
  endpoint: string
  projectName: string
}

let runtime: RuntimeState | undefined

/**
 * Initialise the Phoenix telemetry pipeline. Idempotent — calling
 * twice with the same config is a no-op; calling with a changed
 * endpoint reconfigures the exporter.
 *
 * Lazy: not called from module load; the LLM call path invokes
 * `ensurePhoenixReady()` when config says it's enabled. Keeps cold
 * start fast for users not running Phoenix.
 */
export function initPhoenix(config: PhoenixConfig): void {
  if (!config.enabled) {
    if (runtime) {
      log.info("disabling Phoenix telemetry (config flipped to disabled)")
      void runtime.provider.shutdown()
      runtime = undefined
    }
    return
  }
  const endpoint = config.endpoint?.trim() || DEFAULT_PHOENIX_ENDPOINT
  const projectName = config.projectName?.trim() || DEFAULT_PHOENIX_PROJECT
  if (runtime && runtime.endpoint === endpoint && runtime.projectName === projectName) {
    return
  }
  if (runtime) {
    void runtime.provider.shutdown()
    runtime = undefined
  }

  const exporter = new OTLPTraceExporter({
    url: endpoint,
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
  })

  // Phoenix expects spans in OpenInference's flavour. The vercel
  // adapter's processor inspects each span: those that look like AI
  // SDK gen_ai spans get rewritten in-place; everything else is
  // forwarded unchanged via the BatchSpanProcessor wrap.
  const openinference: SpanProcessor = new OpenInferenceSimpleSpanProcessor({
    exporter,
    spanFilter: (span) => isOpenInferenceSpan(span),
  })
  const fallthrough: SpanProcessor = new BatchSpanProcessor(exporter)

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "librecode",
      [ATTR_SERVICE_VERSION]: process.env.LIBRECODE_VERSION ?? "0.9.76",
      // OpenInference uses this attribute as the project key in
      // Phoenix's sidebar. Without it everything lands under "default".
      "openinference.project.name": projectName,
    }),
    spanProcessors: [openinference, fallthrough],
  })
  provider.register()

  runtime = { provider, endpoint, projectName }
  log.info("Phoenix telemetry initialised", { endpoint, projectName })
}

/**
 * Pure: derive the `/healthz` URL from a `/v1/traces` endpoint.
 * Phoenix exposes both on the same host:port, so we strip the path
 * suffix and append `/healthz`.
 *
 * Exported so the route handler + tests can both call it.
 */
export function healthzUrlFor(endpoint: string): string {
  // `http://host:6006/v1/traces` → `http://host:6006/healthz`
  // `http://host:6006/`         → `http://host:6006/healthz`
  // `http://host:6006`          → `http://host:6006/healthz`
  try {
    const url = new URL(endpoint)
    url.pathname = "/healthz"
    url.search = ""
    return url.toString()
  } catch {
    return `${endpoint.replace(/\/+$/, "")}/healthz`
  }
}

export interface PhoenixHealth {
  ok: boolean
  endpoint: string
  status: number | undefined
  latencyMs: number
  error?: string
}

/**
 * Ping Phoenix's `/healthz` and report success + latency. Used by the
 * Control Panel's Telemetry tab to surface a green/red indicator.
 *
 * Never throws — returns a structured `PhoenixHealth` so the UI can
 * render the failure mode (timeout vs 4xx vs network error) without
 * a try/catch on every call site.
 */
export async function checkPhoenixHealth(
  config: PhoenixConfig,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<PhoenixHealth> {
  const endpoint = config.endpoint?.trim() || DEFAULT_PHOENIX_ENDPOINT
  const url = healthzUrlFor(endpoint)
  const fetchFn = opts.fetchFn ?? fetch
  const timeout = opts.timeoutMs ?? 3000
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetchFn(url, { method: "GET", signal: controller.signal })
    return {
      ok: res.ok,
      endpoint: url,
      status: res.status,
      latencyMs: Date.now() - start,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    }
  } catch (err) {
    return {
      ok: false,
      endpoint: url,
      status: undefined,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Internal accessor for tests + the LLM call path. Returns the
 * current runtime state (after `initPhoenix` has been called) or
 * `undefined` when telemetry is off.
 */
export function getPhoenixRuntime(): { endpoint: string; projectName: string } | undefined {
  if (!runtime) return undefined
  return { endpoint: runtime.endpoint, projectName: runtime.projectName }
}

/**
 * Test seam — wipe runtime state so a test can call `initPhoenix`
 * cleanly without spawning a real OTLP exporter on import.
 */
export async function resetPhoenixRuntime(): Promise<void> {
  if (runtime) {
    try {
      await runtime.provider.shutdown()
    } catch {
      // best effort
    }
    runtime = undefined
  }
}
