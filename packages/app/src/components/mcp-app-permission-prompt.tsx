/**
 * Inline permission prompt rendered inside an MCP app's tab when the
 * iframe issues a `tools/call` that needs user consent.
 *
 * Surface chosen per the user's v0.9.42 decision: separate UI from the
 * agent's composer dock so MCP-app prompts don't preempt the agent and
 * are visually distinguishable from agent-initiated tool calls.
 *
 * Three grant tiers (per ADR-005 §2 + the user's input):
 *   * Allow once     → server runs the tool this one time, no rule stored
 *   * This session   → in-memory grant for the rest of this session
 *   * Always         → persistent project rule, applies in future sessions
 *   * Deny           → reject this call (and any other queued in this session)
 */
import { Button } from "@librecode/ui/button"
import { For, Show, type JSX } from "solid-js"
import type { PermissionRequest } from "@librecode/sdk/v2/client"

export type AppPromptDecision = "once" | "session" | "always" | "reject"

export interface McpAppPermissionPromptProps {
  /** Pending permission request matched to this app panel (server + uri). */
  request: PermissionRequest
  /** Display name of the app (from McpAppResource.name). Falls back to the server name. */
  appName: string
  /** True while a previous decision is mid-flight to the host — disables buttons. */
  responding: boolean
  /** User chose a tier. Component does not call the server itself; parent does. */
  onDecide: (decision: AppPromptDecision) => void
}

/**
 * Given a `mcp-app:<server>:<tool>` permission name, extract the tool
 * name for the prompt copy. Returns the whole string if it doesn't
 * match the expected shape (defensive — user-facing text shouldn't
 * crash if the format ever drifts).
 */
export function toolFromPermission(permission: string): string {
  const parts = permission.split(":")
  if (parts.length < 3 || parts[0] !== "mcp-app") return permission
  return parts.slice(2).join(":")
}

/** Pretty-print arguments for display. Truncates long object dumps. */
export function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return ""
  try {
    const text = typeof args === "string" ? args : JSON.stringify(args, null, 2)
    if (text.length <= 240) return text
    return `${text.slice(0, 240)}…`
  } catch {
    return String(args)
  }
}

export function McpAppPermissionPrompt(props: McpAppPermissionPromptProps): JSX.Element {
  const tool = () => toolFromPermission(props.request.permission)
  const args = () => {
    const meta = props.request.metadata as { arguments?: unknown } | null | undefined
    return formatArgs(meta?.arguments)
  }

  return (
    <div
      data-component="mcp-app-permission-prompt"
      class="border-t border-border-weak-base bg-surface-panel px-3 py-3 flex flex-col gap-3 text-12-regular"
    >
      <div class="flex items-baseline gap-1.5">
        <span class="text-text-strong text-12-medium">{props.appName}</span>
        <span class="text-text-weak">wants to run</span>
        <code class="px-1.5 py-0.5 rounded bg-background-stronger text-text-strong font-mono text-11-regular">
          {tool()}
        </code>
      </div>

      <Show when={args()}>
        <pre class="px-2 py-1.5 rounded bg-background-stronger overflow-x-auto text-11-regular text-text-weak whitespace-pre-wrap">
          {args()}
        </pre>
      </Show>

      <Show when={(props.request.patterns ?? []).length > 0}>
        <div class="text-11-regular text-text-weaker">
          From{" "}
          <For each={props.request.patterns ?? []}>
            {(pat, i) => (
              <>
                <Show when={i() > 0}>
                  <span>, </span>
                </Show>
                <code class="font-mono">{pat}</code>
              </>
            )}
          </For>
        </div>
      </Show>

      <div class="flex flex-wrap items-center gap-2 justify-end">
        <Button variant="ghost" size="small" disabled={props.responding} onClick={() => props.onDecide("reject")}>
          Deny
        </Button>
        <Button variant="ghost" size="small" disabled={props.responding} onClick={() => props.onDecide("always")}>
          Always allow
        </Button>
        <Button variant="ghost" size="small" disabled={props.responding} onClick={() => props.onDecide("session")}>
          For this session
        </Button>
        <Button variant="primary" size="small" disabled={props.responding} onClick={() => props.onDecide("once")}>
          Allow once
        </Button>
      </div>
    </div>
  )
}
