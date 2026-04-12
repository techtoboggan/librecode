import * as prompts from "@clack/prompts"
import type { Hooks } from "@librecode/plugin"
import { map, pipe, sortBy, values } from "remeda"
import { Config } from "../../../config/config"
import { Plugin } from "../../../plugin"
import { ModelsDev } from "../../../provider/models"
import { UI } from "../../ui"

function isProviderIncluded(
  id: string,
  existingProviders: Record<string, unknown>,
  disabled: Set<string>,
  enabled?: Set<string>,
): boolean {
  if (Object.hasOwn(existingProviders, id)) return false
  if (disabled.has(id)) return false
  if (enabled && !enabled.has(id)) return false
  return true
}

export function resolvePluginProviders(input: {
  hooks: Hooks[]
  existingProviders: Record<string, unknown>
  disabled: Set<string>
  enabled?: Set<string>
  providerNames: Record<string, string | undefined>
}): Array<{ id: string; name: string }> {
  const seen = new Set<string>()
  const result: Array<{ id: string; name: string }> = []
  for (const hook of input.hooks) {
    if (!hook.auth) continue
    const id = hook.auth.provider
    if (seen.has(id)) continue
    if (!isProviderIncluded(id, input.existingProviders, input.disabled, input.enabled)) continue
    seen.add(id)
    result.push({ id, name: input.providerNames[id] ?? id })
  }
  return result
}

const PROVIDER_PRIORITY: Record<string, number> = {
  openai: 1,
  "github-copilot": 2,
  google: 3,
  anthropic: 4,
  openrouter: 5,
  vercel: 6,
}

export async function buildProviderOptions(): Promise<{
  options: Array<{ label: string; value: string; hint?: string }>
  pluginProviders: Array<{ id: string; name: string }>
}> {
  await ModelsDev.refresh().catch(() => {})
  const config = await Config.get()
  const disabled = new Set(config.disabled_providers ?? [])
  const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

  const allProviders = await ModelsDev.get()
  const providers: Record<string, (typeof allProviders)[string]> = {}
  for (const [key, value] of Object.entries(allProviders)) {
    if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
      providers[key] = value
    }
  }

  const pluginProviders = resolvePluginProviders({
    hooks: await Plugin.list(),
    existingProviders: providers,
    disabled,
    enabled,
    providerNames: Object.fromEntries(Object.entries(config.provider ?? {}).map(([id, p]) => [id, p.name])),
  })

  const options = [
    ...pipe(
      providers,
      values(),
      sortBy(
        (x) => PROVIDER_PRIORITY[x.id] ?? 99,
        (x) => x.name ?? x.id,
      ),
      map((x) => ({
        label: x.name,
        value: x.id,
        hint: { anthropic: "API key", openai: "ChatGPT Plus/Pro or API key" }[x.id],
      })),
    ),
    ...pluginProviders.map((x) => ({ label: x.name, value: x.id, hint: "plugin" })),
  ]

  return { options, pluginProviders }
}

export async function selectProvider(
  options: Array<{ label: string; value: string; hint?: string }>,
  argProvider?: string,
): Promise<string> {
  if (argProvider) {
    const byID = options.find((x) => x.value === argProvider)
    const byName = options.find((x) => x.label.toLowerCase() === argProvider.toLowerCase())
    const match = byID ?? byName
    if (!match) {
      prompts.log.error(`Unknown provider "${argProvider}"`)
      process.exit(1)
    }
    return match.value
  }

  const selected = await prompts.autocomplete({
    message: "Select provider",
    maxItems: 8,
    options: [...options, { value: "other", label: "Other" }],
  })
  if (prompts.isCancel(selected)) throw new UI.CancelledError()
  return selected as string
}
