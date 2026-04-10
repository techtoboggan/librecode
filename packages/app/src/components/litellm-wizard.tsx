import { Button } from "@librecode/ui/button"
import { Checkbox } from "@librecode/ui/checkbox"
import { Icon } from "@librecode/ui/icon"
import { Spinner } from "@librecode/ui/spinner"
import { TextField } from "@librecode/ui/text-field"
import { showToast } from "@librecode/ui/toast"
import { batch, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
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
}

type WizardStep =
  | "checking" // Auto-checking localhost:4000
  | "not-found" // Nothing found, show connect form
  | "connecting" // User clicked Connect
  | "scanning" // Network scan in progress
  | "servers" // Multiple servers found, show server list
  | "models" // Show models from selected server
  | "added" // Models added successfully
  | "error"

const LITELLM_DEFAULT_URL = "http://localhost:4000"
const CHECK_TIMEOUT_MS = 3000
const COMMON_PORTS = [4000, 8000, 8080, 11434, 3000, 5000, 8001, 9000]

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

/** Scan ALL common ports on localhost — returns ALL discovered servers, not just the first */
async function scanAllServers(
  onProgress?: (checked: number, total: number, found: DiscoveredServer[]) => void,
): Promise<DiscoveredServer[]> {
  const servers: DiscoveredServer[] = []
  const total = COMMON_PORTS.length

  // Scan all ports in parallel for speed
  const results = await Promise.allSettled(
    COMMON_PORTS.map(async (port, index) => {
      const url = `http://localhost:${port}`
      const models = await fetchModels(url)
      if (models.length > 0) {
        const server: DiscoveredServer = { url, modelCount: models.length, models }
        servers.push(server)
      }
      onProgress?.(index + 1, total, [...servers])
    }),
  )

  return servers
}

export function LiteLLMWizard() {
  const globalSync = useGlobalSync()

  const [step, setStep] = createSignal<WizardStep>("checking")
  const [url, setUrl] = createSignal(LITELLM_DEFAULT_URL)
  const [apiKey, setApiKey] = createSignal("")
  const [error, setError] = createSignal("")
  const [scanProgress, setScanProgress] = createSignal({ checked: 0, total: 0 })
  const [servers, setServers] = createStore<DiscoveredServer[]>([])
  const [selectedServer, setSelectedServer] = createSignal<DiscoveredServer | null>(null)
  const [models, setModels] = createStore<DiscoveredModel[]>([])
  const [saving, setSaving] = createSignal(false)

  const selectedCount = () => models.filter((m) => m.selected).length

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
    setSelectedServer(server)
    setUrl(server.url)
    setModels(server.models.map((m) => ({ id: m.id, name: m.name, selected: true })))
    setStep("models")
  }

  const autoCheck = async () => {
    setStep("checking")
    const discovered = await fetchModels(LITELLM_DEFAULT_URL)
    if (discovered.length > 0) {
      setUrl(LITELLM_DEFAULT_URL)
      setModels(discovered.map((m) => ({ ...m, selected: true })))
      setStep("models")
    } else {
      setStep("not-found")
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

  const handleScan = async () => {
    setStep("scanning")
    setError("")
    setScanProgress({ checked: 0, total: COMMON_PORTS.length })

    const found = await scanAllServers((checked, total, foundSoFar) => {
      setScanProgress({ checked, total })
      setServers([...foundSoFar])
    })

    if (found.length === 0) {
      setError("No OpenAI-compatible servers found on common local ports.")
      setStep("not-found")
    } else if (found.length === 1) {
      // Single server — go straight to models
      showServerModels(found[0])
    } else {
      // Multiple servers — show server list
      setServers([...found])
      setStep("servers")
    }
  }

  const handleAddModels = async () => {
    const selected = models.filter((m) => m.selected)
    if (selected.length === 0) return

    setSaving(true)

    const baseUrl = url().trim().replace(/\/+$/, "")
    const key = apiKey().trim() || undefined
    const providerID = `litellm-${baseUrl.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`
    const modelConfig = Object.fromEntries(selected.map((m) => [m.id, { name: m.name }]))

    const disabledProviders = globalSync.data.config.disabled_providers ?? []
    const nextDisabled = disabledProviders.filter((id: string) => id !== providerID)

    try {
      await globalSync.updateConfig({
        provider: {
          [providerID]: {
            npm: "@ai-sdk/openai-compatible",
            name: `LiteLLM (${baseUrl})`,
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
        title: `Added ${selected.length} model${selected.length === 1 ? "" : "s"} from LiteLLM`,
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
    autoCheck()
  })

  return (
    <div class="w-full rounded-sm border border-border-weak-base bg-surface-raised-base">
      <div class="w-full flex flex-col items-start px-4 pt-4 pb-4">
        <div class="flex items-center gap-2 mb-3">
          <Icon name="lightning" class="text-icon-strong-base size-4" />
          <span class="text-14-medium text-text-base">LiteLLM Auto-Discovery</span>
        </div>

        <Switch>
          {/* Auto-checking localhost */}
          <Match when={step() === "checking"}>
            <div class="flex items-center gap-2 text-13-regular text-text-weak">
              <Spinner class="size-3.5" />
              <span>Checking for LiteLLM on localhost:4000...</span>
            </div>
          </Match>

          {/* Connecting to user-specified URL */}
          <Match when={step() === "connecting"}>
            <div class="flex items-center gap-2 text-13-regular text-text-weak">
              <Spinner class="size-3.5" />
              <span>Connecting to {url()}...</span>
            </div>
          </Match>

          {/* Scanning network */}
          <Match when={step() === "scanning"}>
            <div class="flex flex-col gap-2 w-full">
              <div class="flex items-center gap-2 text-13-regular text-text-weak">
                <Spinner class="size-3.5" />
                <span>
                  Scanning ports... ({scanProgress().checked}/{scanProgress().total})
                </span>
              </div>
              {/* Show servers as they're found during scan */}
              <Show when={servers.length > 0}>
                <div class="text-13-regular text-text-base">
                  Found {servers.length} server{servers.length === 1 ? "" : "s"} so far...
                </div>
              </Show>
            </div>
          </Match>

          {/* Nothing found — show connect form */}
          <Match when={step() === "not-found"}>
            <div class="flex flex-col gap-3 w-full">
              <p class="text-13-regular text-text-weak">
                No LiteLLM server found. Enter an address or scan your network.
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

              <div class="flex items-center gap-2">
                <Button size="small" variant="primary" onClick={handleConnect} disabled={!url().trim()}>
                  Connect
                </Button>
                <Button size="small" variant="ghost" onClick={handleScan} icon="search">
                  Scan Network
                </Button>
              </div>
            </div>
          </Match>

          {/* Multiple servers found — server list view */}
          <Match when={step() === "servers"}>
            <div class="flex flex-col gap-3 w-full">
              <p class="text-13-regular text-text-base">
                Found {servers.length} server{servers.length === 1 ? "" : "s"} on your network:
              </p>

              <div class="flex flex-col gap-0.5 max-h-48 overflow-y-auto rounded-sm border border-border-weak-base bg-surface-base">
                <For each={servers}>
                  {(server) => (
                    <button
                      class="flex items-center justify-between w-full px-3 py-2.5 hover:bg-surface-raised-base cursor-pointer transition-colors text-left"
                      onClick={() => showServerModels(server)}
                    >
                      <div class="flex flex-col gap-0.5">
                        <span class="text-13-medium text-text-base font-mono">{server.url}</span>
                        <span class="text-12-regular text-text-weak">
                          {server.modelCount} model{server.modelCount === 1 ? "" : "s"} available
                        </span>
                      </div>
                      <Icon name="chevron-right" class="text-icon-weak-base size-4" />
                    </button>
                  )}
                </For>
              </div>

              <div class="flex items-center gap-2">
                <Button size="small" variant="ghost" onClick={handleScan} icon="search">
                  Scan Again
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => setStep("not-found")}
                >
                  Enter manually
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
                {/* Back to server list if we came from multi-server scan */}
                <Show when={servers.length > 1}>
                  <Button size="small" variant="ghost" onClick={() => setStep("servers")} icon="chevron-left">
                    Back to servers
                  </Button>
                </Show>
                {/* Change server if single server or manual connect */}
                <Show when={servers.length <= 1}>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => {
                      batch(() => {
                        setStep("not-found")
                        setModels([])
                      })
                    }}
                  >
                    Change server
                  </Button>
                </Show>
              </div>
            </div>
          </Match>

          {/* Models added successfully */}
          <Match when={step() === "added"}>
            <div class="flex items-center gap-2 text-13-regular text-text-base">
              <Icon name="circle-check" class="text-icon-positive-base size-3.5" />
              <span>Models added from LiteLLM. Select one below to start using it.</span>
            </div>
          </Match>

          {/* Error state */}
          <Match when={step() === "error"}>
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2 text-13-regular text-text-critical">
                <Icon name="circle-ban-sign" class="text-icon-critical-base size-3.5" />
                <span>{error()}</span>
              </div>
              <Button size="small" variant="ghost" onClick={autoCheck}>
                Try again
              </Button>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
