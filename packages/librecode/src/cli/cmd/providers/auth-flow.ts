import { Auth } from "../../../auth"
import * as prompts from "@clack/prompts"
import { UI } from "../../ui"
import type { AuthHook, AuthOuathResult } from "@librecode/plugin"

type AuthMethod = AuthHook["methods"][number]

type OAuthSuccess = {
  type: "success"
  provider?: string
} & ({ refresh: string; access: string; expires: number; accountId?: string } | { key: string })

async function selectAuthMethod(
  methods: AuthHook["methods"],
  methodName?: string,
): Promise<AuthMethod> {
  let index = 0
  if (methodName) {
    const match = methods.findIndex((x) => x.label.toLowerCase() === methodName.toLowerCase())
    if (match === -1) {
      prompts.log.error(
        `Unknown method "${methodName}". Available: ${methods.map((x) => x.label).join(", ")}`,
      )
      process.exit(1)
    }
    index = match
  } else if (methods.length > 1) {
    const method = await prompts.select({
      message: "Login method",
      options: methods.map((x, i) => ({ label: x.label, value: i.toString() })),
    })
    if (prompts.isCancel(method)) throw new UI.CancelledError()
    index = parseInt(method)
  }
  return methods[index]
}

async function collectSingleInput(
  prompt: NonNullable<AuthMethod["prompts"]>[number],
  inputs: Record<string, string>,
): Promise<string | null> {
  if (prompt.condition && !prompt.condition(inputs)) return null
  if (prompt.type === "select") {
    const value = await prompts.select({ message: prompt.message, options: prompt.options })
    if (prompts.isCancel(value)) throw new UI.CancelledError()
    return value
  }
  const value = await prompts.text({
    message: prompt.message,
    placeholder: prompt.placeholder,
    validate: prompt.validate ? (v) => prompt.validate!(v ?? "") : undefined,
  })
  if (prompts.isCancel(value)) throw new UI.CancelledError()
  return value
}

async function collectPromptInputs(method: AuthMethod): Promise<Record<string, string>> {
  const inputs: Record<string, string> = {}
  if (!method.prompts) return inputs
  for (const prompt of method.prompts) {
    const value = await collectSingleInput(prompt, inputs)
    if (value !== null) inputs[prompt.key] = value
  }
  return inputs
}

async function saveOAuthResult(result: OAuthSuccess, provider: string): Promise<void> {
  const saveProvider = result.provider ?? provider
  if ("refresh" in result) {
    const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
    await Auth.set(saveProvider, { type: "oauth", refresh, access, expires, ...extraFields })
  }
  if ("key" in result) {
    await Auth.set(saveProvider, { type: "api", key: result.key })
  }
}

async function handleOAuthAuto(
  authorize: Extract<AuthOuathResult, { method: "auto" }>,
  provider: string,
): Promise<void> {
  if (authorize.instructions) prompts.log.info(authorize.instructions)
  const spinner = prompts.spinner()
  spinner.start("Waiting for authorization...")
  const result = await authorize.callback()
  if (result.type === "failed") {
    spinner.stop("Failed to authorize", 1)
    return
  }
  await saveOAuthResult(result, provider)
  spinner.stop("Login successful")
}

async function handleOAuthCode(
  authorize: Extract<AuthOuathResult, { method: "code" }>,
  provider: string,
): Promise<void> {
  const code = await prompts.text({
    message: "Paste the authorization code here: ",
    validate: (x) => (x && x.length > 0 ? undefined : "Required"),
  })
  if (prompts.isCancel(code)) throw new UI.CancelledError()
  const result = await authorize.callback(code)
  if (result.type === "failed") {
    prompts.log.error("Failed to authorize")
    return
  }
  await saveOAuthResult(result, provider)
  prompts.log.success("Login successful")
}

async function handleOAuthMethod(
  method: Extract<AuthMethod, { type: "oauth" }>,
  inputs: Record<string, string>,
  provider: string,
): Promise<void> {
  const authorize = await method.authorize(inputs)
  if (authorize.url) prompts.log.info("Go to: " + authorize.url)
  if (authorize.method === "auto") await handleOAuthAuto(authorize, provider)
  if (authorize.method === "code") await handleOAuthCode(authorize, provider)
  prompts.outro("Done")
}

async function handleApiMethod(
  method: Extract<AuthMethod, { type: "api" }>,
  inputs: Record<string, string>,
  provider: string,
): Promise<void> {
  if (!method.authorize) return
  const result = await method.authorize(inputs)
  if (result.type === "failed") prompts.log.error("Failed to authorize")
  if (result.type === "success") {
    await Auth.set(result.provider ?? provider, { type: "api", key: result.key })
    prompts.log.success("Login successful")
  }
  prompts.outro("Done")
}

export async function handlePluginAuth(
  plugin: { auth: AuthHook },
  provider: string,
  methodName?: string,
): Promise<boolean> {
  const method = await selectAuthMethod(plugin.auth.methods, methodName)
  await new Promise((r) => setTimeout(r, 10))
  const inputs = await collectPromptInputs(method)

  if (method.type === "oauth") {
    await handleOAuthMethod(method, inputs, provider)
    return true
  }
  if (method.type === "api") {
    await handleApiMethod(method, inputs, provider)
    return true
  }
  return false
}
