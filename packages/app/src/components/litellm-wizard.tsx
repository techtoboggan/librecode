import { Button } from "@librecode/ui/button"
import { Checkbox } from "@librecode/ui/checkbox"
import { Icon } from "@librecode/ui/icon"
import { Spinner } from "@librecode/ui/spinner"
import { TextField } from "@librecode/ui/text-field"
import { showToast } from "@librecode/ui/toast"
import { batch, createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"

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

const CHECK_TIMEOUT_MS = 3000

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

async function fetchModels(baseUrl: string, apiKey?: string): Promise<{ id: string; name: string }[]> {
  const url = baseUrl.replace(/\/+$/, "")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

  try {
    const response = await fetch(`${url}/v1/models`, { headers, signal: controller.signal })
    if (!response.ok) return []
    const data = await response.json()
    if (!data?.data || !Array.isArray(data.data)) return []
    return data.data.map((m: { id: string }) => ({ id: m.id, name: m.id }))
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

function makeProviderID(url: string): string {
  return `litellm-${url.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`
}

function sortServers(servers: DiscoveredServer[]): void {
  servers.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? 1 : -1
    // localhost first, then by URL
    const aLocal = a.url.includes("localhost") || a.url.includes("127.0.0.1")
    const bLocal = b.url.includes("localhost") || b.url.includes("127.0.0.1")
    if (aLocal !== bLocal) return aLocal ? -1 : 1
    return a.url.localeCompare(b.url)
  })
}

/** Scan known ports on localhost */
async function scanLocalServers(
  connectedProviders: Set<string>,
  onProgress?: (checked: number, total: number, found: DiscoveredServer[]) => void,
): Promise<DiscoveredServer[]> {
  const servers: DiscoveredServer[] = []
  const total = KNOWN_PORTS.length

  await Promise.allSettled(
    KNOWN_PORTS.map(async (entry, index) => {
      const url = `http://localhost:${entry.port}`
      const models = await fetchModels(url)
      if (models.length > 0) {
        servers.push({
          url,
          modelCount: models.length,
          models,
          serverName: entry.name,
          connected: connectedProviders.has(makeProviderID(url)),
        })
      }
      onProgress?.(index + 1, total, [...servers])
    }),
  )

  sortServers(servers)
  return servers
}

/** Detect LAN IP range from WebRTC or common subnets, then scan known ports on each host */
async function scanNetworkServers(
  connectedProviders: Set<string>,
  existingServers: DiscoveredServer[],
  onProgress?: (checked: number, total: number, found: DiscoveredServer[]) => void,
): Promise<DiscoveredServer[]> {
  // Start with existing localhost results
  const servers: DiscoveredServer[] = [...existingServers]
  const seen = new Set(servers.map((s) => s.url))

  // Detect local IP to find the subnet
  let subnet = "192.168.1"
  try {
    const resp = await fetch("http://localhost:4096/global/health").catch(() => null)
    // If the librecode server is running, we can try to infer the subnet from the
    // network interfaces. Fallback: scan common subnets.
  } catch {
    // ignore
  }

  // Try common private subnets — scan a focused range (x.x.x.1-50) on key ports only
  // Use fewer ports for network scan to keep it fast
  const networkPorts = [4000, 11434, 8000, 8080]
  const subnets = ["192.168.1", "192.168.0", "192.168.86", "10.0.0", "10.0.1"]

  // Build host list: .1 through .30 on each subnet (150 hosts × 4 ports = 600 checks)
  const hostRange = 30
  const targets: Array<{ host: string; port: number; name: string }> = []
  for (const sub of subnets) {
    for (let i = 1; i <= hostRange; i++) {
      for (const entry of KNOWN_PORTS.filter((p) => networkPorts.includes(p.port))) {
        targets.push({ host: `${sub}.${i}`, port: entry.port, name: entry.name })
      }
    }
  }

  const total = targets.length
  let checked = 0

  // Scan in batches of 50 to avoid overwhelming the network
  const BATCH_SIZE = 50
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE)
    await Promise.allSettled(
      batch.map(async (target) => {
        const url = `http://${target.host}:${target.port}`
        if (seen.has(url)) {
          checked++
          return
        }
        const models = await fetchModels(url)
        checked++
        if (models.length > 0) {
          seen.add(url)
          servers.push({
            url,
            modelCount: models.length,
            models,
            serverName: `${target.name} (${target.host})`,
            connected: connectedProviders.has(makeProviderID(url)),
          })
        }
        onProgress?.(checked, total, [...servers])
      }),
    )
    onProgress?.(checked, total, [...servers])
  }

  sortServers(servers)
  return servers
}

export function LiteLLMWizard() {
  const globalSync = useGlobalSync()

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

  const handleScan = async () => {
    setStep("scanning")
    setError("")
    setScanProgress({ checked: 0, total: KNOWN_PORTS.length })

    const found = await scanLocalServers(connectedProviderIDs(), (checked, total, foundSoFar) => {
      setScanProgress({ checked, total })
      setServers([...foundSoFar])
    })

    if (found.length === 0) {
      setStep("not-found")
    } else {
      setServers([...found])
      setStep("idle")
    }
  }

  const handleNetworkScan = async () => {
    setStep("scanning")
    setError("")
    const existing = [...servers]

    const found = await scanNetworkServers(connectedProviderIDs(), existing, (checked, total, foundSoFar) => {
      setScanProgress({ checked, total })
      setServers([...foundSoFar])
    })

    if (found.length === 0) {
      setError("No additional servers found on the local network.")
      setStep("not-found")
    } else {
      setServers([...found])
      setStep("idle")
    }
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
            <div class="flex flex-col gap-2 w-full">
              <div class="flex items-center gap-2 text-13-regular text-text-weak">
                <Spinner class="size-3.5" />
                <span>
                  Scanning{scanProgress().total > KNOWN_PORTS.length ? " network" : " local"} ports... ({scanProgress().checked}/{scanProgress().total})
                </span>
              </div>
              <Show when={servers.length > 0}>
                <div class="text-13-regular text-text-base">
                  Found {servers.length} server{servers.length === 1 ? "" : "s"} so far...
                </div>
              </Show>
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
                <Button size="small" variant="ghost" onClick={handleScan} icon="dot-grid">
                  Scan Local
                </Button>
                <Button size="small" variant="ghost" onClick={handleNetworkScan} icon="dot-grid">
                  Scan Network
                </Button>
                <Button size="small" variant="ghost" onClick={() => setStep("not-found")}>
                  Enter manually
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
                <Button size="small" variant="ghost" onClick={handleScan} icon="dot-grid">
                  Scan Local
                </Button>
                <Button size="small" variant="ghost" onClick={handleNetworkScan} icon="dot-grid">
                  Scan Network
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
                <Button size="small" variant="ghost" onClick={handleScan} icon="dot-grid">
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
              <Button size="small" variant="ghost" onClick={handleScan}>
                Try again
              </Button>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
