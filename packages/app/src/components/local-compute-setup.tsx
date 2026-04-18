import { Button } from "@librecode/ui/button"
import { Icon } from "@librecode/ui/icon"
import { Spinner } from "@librecode/ui/spinner"
import { createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useServer } from "@/context/server"

type SetupStep = "detecting" | "recommend" | "verifying" | "done" | "error"

type SystemInfo = {
  os: string
  arch: string
  gpuVendor?: string
  gpuModel?: string
  cudaVersion?: string
  rocmVersion?: string
  metalSupported?: boolean
}

type Recommendation = {
  name: string
  description: string
  installCommands: string[]
  defaultPort: number
  docsUrl: string
}

function getRecommendations(info: SystemInfo): Recommendation[] {
  const recs: Recommendation[] = []
  const isNvidia = info.gpuVendor === "NVIDIA"
  const isAmd = info.gpuVendor === "AMD"
  const isMetal = info.metalSupported

  // Ollama is always the top recommendation — easiest to set up
  const ollamaCmd =
    info.os === "darwin"
      ? "brew install ollama && ollama serve"
      : info.os === "win32"
        ? "winget install Ollama.Ollama"
        : "curl -fsSL https://ollama.com/install.sh | sh"

  recs.push({
    name: "Ollama",
    description: `Easiest option${isNvidia ? " — auto-detects NVIDIA GPU" : isMetal ? " — uses Metal acceleration" : ""}. Runs popular models locally with one command.`,
    installCommands: [ollamaCmd, "ollama pull llama3.2"],
    defaultPort: 11434,
    docsUrl: "https://ollama.com",
  })

  // vLLM for NVIDIA + CUDA
  if (isNvidia) {
    recs.push({
      name: "vLLM",
      description: `High-performance inference server optimized for NVIDIA GPUs${info.gpuModel ? ` (${info.gpuModel})` : ""}. Best throughput for production use.`,
      installCommands: ["pip install vllm", 'vllm serve "meta-llama/Llama-3.2-3B-Instruct"'],
      defaultPort: 8000,
      docsUrl: "https://docs.vllm.ai",
    })
  }

  // llama.cpp for CPU or Metal
  if (!isNvidia || isMetal) {
    const buildFlag = isMetal ? "GGML_METAL=1" : isAmd ? "GGML_HIPBLAS=1" : ""
    recs.push({
      name: "llama.cpp",
      description: `Lightweight C++ inference${isMetal ? " with Metal GPU acceleration" : isAmd ? " with ROCm GPU acceleration" : " (CPU)"}. Low memory footprint.`,
      installCommands: [
        "git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp",
        `make ${buildFlag}`.trim(),
        "./llama-server -m models/your-model.gguf --port 8080",
      ],
      defaultPort: 8080,
      docsUrl: "https://github.com/ggerganov/llama.cpp",
    })
  }

  return recs
}

interface LocalComputeSetupProps {
  onBack: () => void
  onComplete: () => void
}

export function LocalComputeSetup(props: LocalComputeSetupProps) {
  const server = useServer()
  const globalSDK = useGlobalSDK()
  const baseUrl = () => server.current?.http?.url ?? globalSDK.url
  const [step, setStep] = createSignal<SetupStep>("detecting")
  const [info, setInfo] = createSignal<SystemInfo | undefined>()
  const [error, setError] = createSignal("")
  const [verifyPort, setVerifyPort] = createSignal(11434)

  const detect = async () => {
    setStep("detecting")
    setError("")
    try {
      const res = await fetch(`${baseUrl()}/system/info`)
      if (!res.ok) throw new Error(`Detection failed (${res.status})`)
      const data = (await res.json()) as SystemInfo
      setInfo(data)
      setStep("recommend")
    } catch (err) {
      setError(err instanceof Error ? err.message : "System detection failed")
      setStep("error")
    }
  }

  const verify = async (port: number) => {
    setVerifyPort(port)
    setStep("verifying")
    setError("")

    // Poll the port for up to 30 seconds
    for (let i = 0; i < 6; i++) {
      try {
        const res = await fetch(`${baseUrl()}/provider/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host: "localhost", ports: [port] }),
        })
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data) && data.length > 0) {
            setStep("done")
            return
          }
        }
      } catch {
        // ignore, retry
      }
      await new Promise((r) => setTimeout(r, 5000))
    }
    setError(`No server detected on port ${port}. Make sure it's running and try again.`)
    setStep("recommend")
  }

  onMount(detect)

  const recommendations = () => {
    const i = info()
    return i ? getRecommendations(i) : []
  }

  return (
    <div class="flex flex-col gap-3 w-full">
      <div class="flex items-center gap-2 mb-1">
        <button class="text-text-weak hover:text-text-base transition-colors cursor-pointer" onClick={props.onBack}>
          <Icon name="arrow-left" class="size-4" />
        </button>
        <span class="text-14-medium text-text-base">Set Up Local Compute</span>
      </div>

      <Switch>
        <Match when={step() === "detecting"}>
          <div class="flex items-center gap-2 text-13-regular text-text-weak">
            <Spinner class="size-3.5" />
            <span>Detecting your hardware...</span>
          </div>
        </Match>

        <Match when={step() === "error"}>
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2 text-13-regular text-text-critical">
              <Icon name="circle-ban-sign" class="text-icon-critical-base size-3.5" />
              <span>{error()}</span>
            </div>
            <Button size="small" variant="ghost" onClick={detect}>
              Retry detection
            </Button>
          </div>
        </Match>

        <Match when={step() === "recommend"}>
          <div class="flex flex-col gap-3">
            {/* System info summary */}
            <Show when={info()}>
              {(i) => (
                <div class="rounded-sm border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular text-text-weak">
                  <div class="flex items-center gap-4 flex-wrap">
                    <span>
                      <strong class="text-text-base">OS:</strong>{" "}
                      {i().os === "darwin" ? "macOS" : i().os === "win32" ? "Windows" : "Linux"} ({i().arch})
                    </span>
                    <Show when={i().gpuModel}>
                      <span>
                        <strong class="text-text-base">GPU:</strong> {i().gpuVendor} {i().gpuModel}
                      </span>
                    </Show>
                    <Show when={i().cudaVersion}>
                      <span>
                        <strong class="text-text-base">CUDA:</strong> {i().cudaVersion}
                      </span>
                    </Show>
                    <Show when={i().rocmVersion}>
                      <span>
                        <strong class="text-text-base">ROCm:</strong> {i().rocmVersion}
                      </span>
                    </Show>
                    <Show when={i().metalSupported}>
                      <span class="text-emerald-500">✓ Metal</span>
                    </Show>
                  </div>
                </div>
              )}
            </Show>

            <Show when={error()}>
              <div class="flex items-center gap-2 text-13-regular text-text-critical">
                <Icon name="circle-ban-sign" class="text-icon-critical-base size-3.5" />
                <span>{error()}</span>
              </div>
            </Show>

            {/* Recommendations */}
            <For each={recommendations()}>
              {(rec) => (
                <div class="rounded-sm border border-border-weak-base bg-surface-base overflow-hidden">
                  <div class="px-3 py-2.5">
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-13-medium text-text-strong">{rec.name}</span>
                      <a
                        href={rec.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-11-regular text-text-weak hover:text-text-base"
                      >
                        docs ↗
                      </a>
                    </div>
                    <p class="text-12-regular text-text-weak mb-2">{rec.description}</p>
                    <div class="flex flex-col gap-1">
                      <For each={rec.installCommands}>
                        {(cmd) => (
                          <code class="block text-11-regular font-mono bg-surface-raised-base px-2 py-1 rounded-sm text-text-base select-all">
                            {cmd}
                          </code>
                        )}
                      </For>
                    </div>
                  </div>
                  <div class="border-t border-border-weak-base px-3 py-2 bg-surface-raised-base">
                    <Button size="small" variant="ghost" onClick={() => verify(rec.defaultPort)}>
                      I've installed it — verify connection
                    </Button>
                  </div>
                </div>
              )}
            </For>

            <p class="text-11-regular text-text-weaker">
              Having trouble?{" "}
              <a
                href="https://github.com/techtoboggan/librecode/issues"
                target="_blank"
                rel="noopener noreferrer"
                class="text-text-weak hover:text-text-base underline"
              >
                Report an issue
              </a>
            </p>
          </div>
        </Match>

        <Match when={step() === "verifying"}>
          <div class="flex items-center gap-2 text-13-regular text-text-weak">
            <Spinner class="size-3.5" />
            <span>Checking port {verifyPort()}...</span>
          </div>
        </Match>

        <Match when={step() === "done"}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-2 text-13-regular text-text-positive">
              <Icon name="check" class="text-icon-positive-base size-4" />
              <span>Server detected on port {verifyPort()}!</span>
            </div>
            <Button size="small" variant="primary" onClick={props.onComplete}>
              Continue to add models
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
