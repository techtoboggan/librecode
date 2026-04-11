import { Button } from "@librecode/ui/button"
import { Checkbox } from "@librecode/ui/checkbox"
import { Icon } from "@librecode/ui/icon"
import { Spinner } from "@librecode/ui/spinner"
import { TextField } from "@librecode/ui/text-field"
import { showToast } from "@librecode/ui/toast"
import { batch, createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"

type DiscoveredModel = {
  id: string
  name: string
  selected: boolean
}

type DiscoveredServer = {
  url: string
  modelCount: number
  models: { id: string; name: string }[]
  serverName: string
  connected: boolean
}

type WizardStep =
  | "idle" // Default: show discovered servers list
  | "scanning" // Network scan in progress
  | "not-found" // Nothing found, show connect form
  | "connecting" // User clicked Connect
  | "models" // Show models from selected server
  | "added" // Models added successfully
  | "error"

/** Well-known ports and what typically runs on them */
const KNOWN_PORTS: Array<{ port: number; name: string }> = [
  { port: 4000, name: "LiteLLM" },
  { port: 11434, name: "Ollama" },
  { port: 8000, name: "vLLM" },
  { port: 8080, name: "llama.cpp" },
  { port: 3000, name: "LocalAI" },
  { port: 5000, name: "Model Server" },
  { port: 8001, name: "Model Server" },
  { port: 9000, name: "Model Server" },
]

/** Guess a human-friendly server name from its port */
function guessServerName(url: string): string {
  try {
    const parsed = new URL(url)
    const port = parseInt(parsed.port, 10)
    const known = KNOWN_PORTS.find((p) => p.port === port)
    return known?.name ?? `Server (:${port})`
  } catch {
    return "Server"
  }
}

const CHECK_TIMEOUT_MS = 3000

/** Fetch models from a server URL (used for manual connect only) */
async function fetchModels(baseUrl: string, apiKey?: string): Promise<Array<{ id: string; name: string }>> {
  const url = baseUrl.replace(/\/+$/, "")
  const headers: Record<string, string> = {}
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

  async function tryEndpoint(endpoint: string): Promise<Array<{ id: string; name: string }>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
    try {
      const response = await fetch(endpoint, { headers, signal: controller.signal })
      clearTimeout(timeout)
      if (!response.ok) return []
      const data = await response.json()
      // OpenAI format
      if (data?.data && Array.isArray(data.data)) {
        return data.data.filter((m: any) => m.id).map((m: any) => ({ id: m.id, name: m.id }))
      }
      // Ollama native format
      if (data?.models && Array.isArray(data.models)) {
        return data.models.filter((m: any) => m.name).map((m: any) => ({ id: m.name, name: m.name }))
      }
      return []
    } catch {
      return []
    }
  }

  // Try OpenAI-compatible first, then Ollama native
  let models = await tryEndpoint(`${url}/v1/models`)
  if (models.length === 0) {
    models = await tryEndpoint(`${url}/api/tags`)
  }
  return models
}

function makeProviderID(url: string): string {
  return `local-${url.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`
}

export function LocalServerWizard() {
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const server = useServer()

  const [step, setStep] = createSignal<WizardStep>("idle")
  const [url, setUrl] = createSignal("http://localhost:4000")
  const [apiKey, setApiKey] = createSignal("")
  const [error, setError] = createSignal("")
  const [scanProgress, setScanProgress] = createSignal({ checked: 0, total: 0 })
  const [servers, setServers] = createStore<DiscoveredServer[]>([])
  const [models, setModels] = createStore<DiscoveredModel[]>([])
  const [saving, setSaving] = createSignal(false)

  const selectedCount = () => models.filter((m) => m.selected).length

  const connectedProviderIDs = createMemo(() => new Set(globalSync.data.provider.connected ?? []))

  /** Call the backend scan endpoint */
  async function callScanEndpoint(remoteHost?: string): Promise<Array<DiscoveredServer>> {
    const httpBase = server.current?.http
    const baseUrl = httpBase?.url ?? globalSDK.url
    const authHeaders: Record<string, string> = { "Content-Type": "application/json" }
    if (httpBase?.password) {
      authHeaders["Authorization"] = `Basic ${btoa(`${httpBase.username ?? "librecode"}:${httpBase.password}`)}`
    }

    const body: Record<string, unknown> = {}
    if (remoteHost) body.host = remoteHost

    const res = await fetch(`${baseUrl}/provider/scan`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[scan] Server returned", res.status, text)
      return []
    }
    const data = (await res.json()) as Array<{
      url: string
      serverName: string
      modelCount: number
      models: Array<{ id: string; name: string }>
    }>
    const connected = connectedProviderIDs()
    return data.map((s) => ({
      ...s,
      connected: connected.has(makeProviderID(s.url)),
    }))
  }

  const setModelSelected = (index: number, selected: boolean) => {
    setModels(index, "selected", selected)
  }

  const toggleAll = () => {
    const allSelected = models.every((m) => m.selected)
    for (let i = 0; i < models.length; i++) {
      setModels(i, "selected", !allSelected)
    }
  }

  const showServerModels = (server: DiscoveredServer) => {
    setUrl(server.url)
    setModels(server.models.map((m) => ({ id: m.id, name: m.name, selected: true })))
    setStep("models")
  }

  const [remoteHost, setRemoteHost] = createSignal("")

  const handleScan = async (host?: string) => {
    setStep("scanning")
    setError("")

    try {
      const found = await callScanEndpoint(host)
      if (found.length === 0 && !host) {
        setStep("not-found")
      } else if (found.length === 0 && host) {
        setError(`No model servers found on ${host}`)
        setStep("idle")
      } else {
        setServers([...found])
        setStep("idle")
      }
    } catch {
      setError("Scan failed — is the LibreCode server running?")
      setStep("not-found")
    }
  }

  const handleAddRemoteHost = async () => {
    const host = remoteHost().trim()
    if (!host) return
    await handleScan(host)
    setRemoteHost("")
  }

  const handleConnect = async () => {
    const baseUrl = url().trim()
    if (!baseUrl) return

    setStep("connecting")
    setError("")

    const discovered = await fetchModels(baseUrl, apiKey().trim() || undefined)
    if (discovered.length > 0) {
      setModels(discovered.map((m) => ({ ...m, selected: true })))
      setStep("models")
    } else {
      setError("Could not connect or no models found at this address.")
      setStep("not-found")
    }
  }

  const handleAddModels = async () => {
    const selected = models.filter((m) => m.selected)
    if (selected.length === 0) return

    setSaving(true)

    const baseUrl = url().trim().replace(/\/+$/, "")
    const key = apiKey().trim() || undefined
    const providerID = `litellm-${baseUrl.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`
    const serverName = guessServerName(baseUrl)
    const modelConfig = Object.fromEntries(selected.map((m) => [m.id, { name: m.name }]))

    const disabledProviders = globalSync.data.config.disabled_providers ?? []
    const nextDisabled = disabledProviders.filter((id: string) => id !== providerID)

    try {
      await globalSync.updateConfig({
        provider: {
          [providerID]: {
            npm: "@ai-sdk/openai-compatible",
            name: `${serverName} (${baseUrl})`,
            options: {
              baseURL: `${baseUrl}/v1`,
              ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}),
            },
            models: modelConfig,
          },
        },
        disabled_providers: nextDisabled,
      })

      setStep("added")
      showToast({
        variant: "success",
        icon: "circle-check",
        title: `Added ${selected.length} model${selected.length === 1 ? "" : "s"} from ${serverName}`,
        description: `Connected to ${baseUrl}`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showToast({ title: "Failed to add models", description: message })
    } finally {
      setSaving(false)
    }
  }

  onMount(() => {
    handleScan()
  })

  return (
    <div class="w-full rounded-sm border border-border-weak-base bg-surface-raised-base">
      <div class="w-full flex flex-col items-start px-4 pt-4 pb-4">
        <div class="flex items-center gap-2 mb-3">
          <Icon name="dot-grid" class="text-icon-strong-base size-4" />
          <span class="text-14-medium text-text-base">Local Server Discovery</span>
        </div>

        <Switch>
          {/* Scanning ports */}
          <Match when={step() === "scanning"}>
            <div class="flex items-center gap-2 text-13-regular text-text-weak">
              <Spinner class="size-3.5" />
              <span>Scanning for model servers...</span>
            </div>
          </Match>

          {/* Connecting to user-specified URL */}
          <Match when={step() === "connecting"}>
            <div class="flex items-center gap-2 text-13-regular text-text-weak">
              <Spinner class="size-3.5" />
              <span>Connecting to {url()}...</span>
            </div>
          </Match>

          {/* Default: show discovered servers */}
          <Match when={step() === "idle"}>
            <div class="flex flex-col gap-3 w-full">
              <Show
                when={servers.length > 0}
                fallback={
                  <p class="text-13-regular text-text-weak">No local model servers detected.</p>
                }
              >
                <div class="flex flex-col gap-0.5 max-h-48 overflow-y-auto rounded-sm border border-border-weak-base bg-surface-base">
                  <For each={servers}>
                    {(server) => (
                      <button
                        class="flex items-center justify-between w-full px-3 py-2.5 hover:bg-surface-raised-base cursor-pointer transition-colors text-left"
                        onClick={() => !server.connected && showServerModels(server)}
                        disabled={server.connected}
                      >
                        <div class="flex flex-col gap-0.5">
                          <div class="flex items-center gap-2">
                            <span class="text-13-medium text-text-base">{server.serverName}</span>
                            <span class="text-12-regular text-text-weak font-mono">{server.url}</span>
                          </div>
                          <span class="text-12-regular text-text-weak">
                            {server.modelCount} model{server.modelCount === 1 ? "" : "s"}
                            {server.connected ? " — already connected" : " available"}
                          </span>
                        </div>
                        <Show when={server.connected} fallback={<Icon name="chevron-right" class="text-icon-weak-base size-4" />}>
                          <Icon name="check" class="text-icon-positive-base size-4" />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <div class="flex items-center gap-2 flex-wrap">
                <Button size="small" variant="ghost" onClick={() => handleScan()} icon="dot-grid">
                  Rescan
                </Button>
                <Button size="small" variant="ghost" onClick={() => setStep("not-found")}>
                  Enter manually
                </Button>
              </div>
              <div class="flex items-center gap-2 w-full">
                <TextField
                  label="Add remote server"
                  hideLabel
                  placeholder="hostname or IP (e.g. 192.168.1.50)"
                  value={remoteHost()}
                  onChange={setRemoteHost}
                  class="flex-1"
                />
                <Button size="small" variant="secondary" onClick={handleAddRemoteHost} disabled={!remoteHost().trim()}>
                  Add Server
                </Button>
              </div>
            </div>
          </Match>

          {/* Nothing found — show connect form */}
          <Match when={step() === "not-found"}>
            <div class="flex flex-col gap-3 w-full">
              <p class="text-13-regular text-text-weak">
                No local servers found. Enter a server address or scan your network.
              </p>

              <Show when={error()}>
                <div class="flex items-center gap-2 text-13-regular text-text-critical">
                  <Icon name="circle-ban-sign" class="text-icon-critical-base size-3.5" />
                  <span>{error()}</span>
                </div>
              </Show>

              <div class="flex flex-col gap-2 w-full">
                <TextField
                  label="Server URL"
                  hideLabel
                  placeholder="http://localhost:4000"
                  value={url()}
                  onChange={setUrl}
                />
                <TextField
                  label="API Key (optional)"
                  hideLabel
                  placeholder="API key (optional)"
                  value={apiKey()}
                  onChange={setApiKey}
                />
              </div>

              <div class="flex items-center gap-2 flex-wrap">
                <Button size="small" variant="primary" onClick={handleConnect} disabled={!url().trim()}>
                  Connect
                </Button>
                <Button size="small" variant="ghost" onClick={() => handleScan()} icon="dot-grid">
                  Scan Local
                </Button>
              </div>
            </div>
          </Match>

          {/* Models from selected server */}
          <Match when={step() === "models"}>
            <div class="flex flex-col gap-3 w-full">
              <div class="flex items-center justify-between w-full">
                <p class="text-13-regular text-text-base">
                  Found {models.length} model{models.length === 1 ? "" : "s"} at{" "}
                  <span class="text-text-strong font-mono text-12-regular">{url()}</span>
                </p>
                <button
                  class="text-12-regular text-text-weak hover:text-text-base transition-colors cursor-pointer"
                  onClick={toggleAll}
                >
                  {models.every((m) => m.selected) ? "Deselect all" : "Select all"}
                </button>
              </div>

              <div class="flex flex-col gap-0.5 max-h-40 overflow-y-auto rounded-sm border border-border-weak-base bg-surface-base">
                <For each={models}>
                  {(model, index) => (
                    <label class="flex items-center gap-2.5 px-3 py-1.5 hover:bg-surface-raised-base cursor-pointer transition-colors">
                      <Checkbox checked={model.selected} onChange={(checked) => setModelSelected(index(), checked)}>
                        <span class="text-13-regular text-text-base font-mono">{model.name}</span>
                      </Checkbox>
                    </label>
                  )}
                </For>
              </div>

              <div class="flex items-center gap-2">
                <Button
                  size="small"
                  variant="primary"
                  onClick={handleAddModels}
                  disabled={selectedCount() === 0 || saving()}
                >
                  <Show when={saving()} fallback={`Add ${selectedCount()} model${selectedCount() === 1 ? "" : "s"}`}>
                    <span class="flex items-center gap-1.5">
                      <Spinner class="size-3" />
                      Adding...
                    </span>
                  </Show>
                </Button>
                <Show when={servers.length > 0}>
                  <Button size="small" variant="ghost" onClick={() => setStep("idle")} icon="chevron-left">
                    Back to servers
                  </Button>
                </Show>
                <Show when={servers.length === 0}>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => {
                      batch(() => { setModels([]) })
                      handleScan()
                    }}
                  >
                    Scan for servers
                  </Button>
                </Show>
              </div>
            </div>
          </Match>

          {/* Models added successfully */}
          <Match when={step() === "added"}>
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-2 text-13-regular text-text-base">
                <Icon name="circle-check" class="text-icon-positive-base size-3.5" />
                <span>Models added. Select one below to start using it.</span>
              </div>
              <div class="flex items-center gap-2">
                <Button size="small" variant="ghost" onClick={() => handleScan()} icon="dot-grid">
                  Scan for more servers
                </Button>
              </div>
            </div>
          </Match>

          {/* Error state */}
          <Match when={step() === "error"}>
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2 text-13-regular text-text-critical">
                <Icon name="circle-ban-sign" class="text-icon-critical-base size-3.5" />
                <span>{error()}</span>
              </div>
              <Button size="small" variant="ghost" onClick={() => handleScan()}>
                Try again
              </Button>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
