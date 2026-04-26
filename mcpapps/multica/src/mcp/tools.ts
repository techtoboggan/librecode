/**
 * v0.9.76 — Multica MCP tools.
 *
 * Three tools the agent can call to mirror its activity into a
 * Multica issue tracker:
 *
 *   - `multica_create_issue`   — open a new issue (e.g. at session start)
 *   - `multica_update_status`  — move the issue between board columns
 *   - `multica_add_comment`    — append a note (e.g. on tool calls)
 *
 * Tools are deliberately thin: each does one REST call. Higher-level
 * "mirror this whole session" orchestration belongs in the host
 * (LibreCode), not in the MCP app.
 */
import { z } from "zod"
import type { IssuePriority, IssueStatus, MulticaClient } from "../multica/client"

const STATUS_VALUES: readonly IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const

const PRIORITY_VALUES: readonly IssuePriority[] = ["no_priority", "urgent", "high", "medium", "low"] as const

export const CreateIssueInput = z.object({
  title: z.string().min(1).max(200).describe("Short title shown on the kanban card"),
  description: z.string().optional().describe("Optional longer description (Markdown)"),
  projectId: z.string().optional().describe("Multica project id this issue belongs to"),
  status: z
    .enum(STATUS_VALUES as [IssueStatus, ...IssueStatus[]])
    .optional()
    .describe("Initial column. Defaults to 'todo'."),
  priority: z
    .enum(PRIORITY_VALUES as [IssuePriority, ...IssuePriority[]])
    .optional()
    .describe("Issue priority. Defaults to 'no_priority'."),
})

export const UpdateStatusInput = z.object({
  identifier: z.string().min(1).describe("Issue identifier (e.g. 'ACME-42') or id"),
  status: z.enum(STATUS_VALUES as [IssueStatus, ...IssueStatus[]]).describe("New column to move the card to"),
})

export const AddCommentInput = z.object({
  identifier: z.string().min(1).describe("Issue identifier (e.g. 'ACME-42') or id"),
  content: z.string().min(1).describe("Comment body (Markdown)"),
})

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
  _meta?: Record<string, unknown>
}

/**
 * Pure: pretty-print a tool error so the agent gets a useful
 * recovery hint instead of a stack trace.
 */
export function formatToolError(err: unknown, toolName: string): ToolResult {
  const message = err instanceof Error ? err.message : String(err)
  return {
    isError: true,
    content: [{ type: "text", text: `${toolName} failed: ${message}` }],
  }
}

export async function runCreateIssue(
  client: MulticaClient,
  input: z.infer<typeof CreateIssueInput>,
): Promise<ToolResult> {
  try {
    const issue = await client.createIssue({
      title: input.title,
      description: input.description,
      projectId: input.projectId,
      status: input.status,
      priority: input.priority,
    })
    return {
      content: [
        {
          type: "text",
          text: `Created Multica issue ${issue.identifier}: "${issue.title}" (status: ${issue.status})`,
        },
      ],
      _meta: { issue },
    }
  } catch (err) {
    return formatToolError(err, "multica_create_issue")
  }
}

export async function runUpdateStatus(
  client: MulticaClient,
  input: z.infer<typeof UpdateStatusInput>,
): Promise<ToolResult> {
  try {
    const issue = await client.updateIssueStatus(input.identifier, input.status)
    return {
      content: [
        {
          type: "text",
          text: `Updated ${issue.identifier} → status ${issue.status}`,
        },
      ],
      _meta: { issue },
    }
  } catch (err) {
    return formatToolError(err, "multica_update_status")
  }
}

export async function runAddComment(
  client: MulticaClient,
  input: z.infer<typeof AddCommentInput>,
): Promise<ToolResult> {
  try {
    const result = await client.addComment(input.identifier, input.content)
    return {
      content: [{ type: "text", text: `Added comment to ${input.identifier}` }],
      _meta: { commentId: result.commentId },
    }
  } catch (err) {
    return formatToolError(err, "multica_add_comment")
  }
}
