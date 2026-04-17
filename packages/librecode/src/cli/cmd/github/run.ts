import path from "node:path"
import * as core from "@actions/core"
import * as github from "@actions/github"
import type { Context } from "@actions/github/lib/context"
import { graphql } from "@octokit/graphql"
import { Octokit } from "@octokit/rest"
import type {
  IssueCommentEvent,
  IssuesEvent,
  PullRequestEvent,
  PullRequestReviewCommentEvent,
  WorkflowDispatchEvent,
  WorkflowRunEvent,
} from "@octokit/webhooks-types"
import { SessionPrompt } from "@/session/prompt"
import { Process } from "@/util/process"
import { Bus } from "../../../bus"
import { Provider } from "../../../provider/provider"
import type { ModelID, ProviderID } from "../../../provider/schema"
import { Session } from "../../../session"
import { MessageV2 } from "../../../session/message-v2"
import type { SessionID } from "../../../session/schema"
import { MessageID, PartID } from "../../../session/schema"
import { bootstrap } from "../../bootstrap"
import { UI } from "../../ui"
import { cmd } from "../cmd"
import { AGENT_USERNAME, addReaction, assertPermissions, createComment, createPR, removeReaction } from "./api-helpers"
import {
  branchIsDirty,
  checkoutForkBranch,
  checkoutLocalBranch,
  checkoutNewBranch,
  gitRun,
  gitStatus,
  gitText,
  pushToForkBranch,
  pushToLocalBranch,
  pushToNewBranch,
} from "./git-helpers"
import type { GitHubPullRequest } from "./queries"
import { buildPromptDataForIssue, buildPromptDataForPR, fetchIssue, fetchPR } from "./queries"
import { extractResponseText, formatPromptTooLargeError } from "./util"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Event categories for routing
// USER_EVENTS: triggered by user actions, have actor/issueId, support reactions/comments
// REPO_EVENTS: triggered by automation, no actor/issueId, output to logs/PR only
const USER_EVENTS = ["issue_comment", "pull_request_review_comment", "issues", "pull_request"] as const
const REPO_EVENTS = ["schedule", "workflow_dispatch"] as const
const SUPPORTED_EVENTS = [...USER_EVENTS, ...REPO_EVENTS] as const

type UserEvent = (typeof USER_EVENTS)[number]
type RepoEvent = (typeof REPO_EVENTS)[number]

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type PromptFile = {
  filename: string
  mime: string
  content: string
  start: number
  end: number
  replacement: string
}

type RunCtx = {
  owner: string
  repo: string
  octoRest: Octokit
  octoGraph: typeof graphql
  appToken: string
  session: { id: SessionID; title: string; version: string }
  defaultBranch?: string
  providerID: ProviderID
  modelID: ModelID
  variant: string | undefined
  issueId: number | undefined
  triggerCommentId: number | undefined
  commentType: "issue" | "pr_review" | undefined
  runUrl: string
  actor: string | undefined
  issueEvent: IssueCommentEvent | undefined
  eventName: string
  payload:
    | IssueCommentEvent
    | IssuesEvent
    | PullRequestReviewCommentEvent
    | WorkflowDispatchEvent
    | WorkflowRunEvent
    | PullRequestEvent
  isCommentEvent: boolean
}

type EventFlags = {
  isUserEvent: boolean
  isRepoEvent: boolean
  isCommentEvent: boolean
  isIssuesEvent: boolean
  isScheduleEvent: boolean
  isWorkflowDispatchEvent: boolean
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const GithubRunCommand = cmd({
  command: "run",
  describe: "run the GitHub agent",
  builder: (yargs) =>
    yargs
      .option("event", {
        type: "string",
        describe: "GitHub mock event to run the agent for",
      })
      .option("token", {
        type: "string",
        describe: "GitHub personal access token (github_pat_********)",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), () => runGithubAction(args))
  },
})

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function runGithubAction(args: { token?: string; event?: string }): Promise<void> {
  const isMock = args.token || args.event
  const context = isMock ? (JSON.parse(args.event ?? "{}") as Context) : github.context
  if (!SUPPORTED_EVENTS.includes(context.eventName as (typeof SUPPORTED_EVENTS)[number])) {
    core.setFailed(`Unsupported event type: ${context.eventName}`)
    process.exit(1)
  }
  const useGithubToken = normalizeUseGithubToken()
  const oidcBaseUrl = normalizeOidcBaseUrl()
  const eventFlags = resolveEventFlags(context.eventName)
  const ctx = buildInitialCtx(context)

  let savedGitConfig: string | undefined
  let exitCode = 0
  try {
    ctx.appToken = await resolveAppToken(useGithubToken, !!isMock, args.token, oidcBaseUrl, ctx.owner, ctx.repo)
    ctx.octoRest = new Octokit({ auth: ctx.appToken })
    ctx.octoGraph = graphql.defaults({ headers: { authorization: `token ${ctx.appToken}` } })
    const { userPrompt, promptFiles } = await getUserPrompt(
      eventFlags.isRepoEvent,
      eventFlags.isIssuesEvent,
      ctx.isCommentEvent,
      ctx.payload,
      ctx.appToken,
      context.eventName,
    )
    if (!useGithubToken) savedGitConfig = await configureGit(ctx.appToken, !!isMock)
    if (eventFlags.isUserEvent) {
      await assertPermissions(ctx.octoRest, ctx.owner, ctx.repo, ctx.actor)
      await addReaction(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, ctx.triggerCommentId, ctx.commentType)
    }
    await initSession(ctx)
    await dispatchEvent(ctx, userPrompt, promptFiles, eventFlags)
  } catch (e: unknown) {
    exitCode = 1
    const msg = formatErrorMessage(e)
    console.error(msg)
    if (eventFlags.isUserEvent && ctx.octoRest && ctx.issueId !== undefined) {
      await createComment(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, `${msg}${buildFooter(ctx)}`)
      await removeReaction(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, ctx.triggerCommentId, ctx.commentType)
    }
    core.setFailed(msg)
  } finally {
    if (!useGithubToken) {
      await restoreGitConfig(savedGitConfig)
      await revokeAppToken(ctx.appToken)
    }
  }
  process.exit(exitCode)
}

// ---------------------------------------------------------------------------
// Context construction
// ---------------------------------------------------------------------------

function buildInitialCtx(context: Context): RunCtx {
  const eventFlags = resolveEventFlags(context.eventName)
  const { providerID, modelID } = normalizeModel()
  const variant = process.env.VARIANT || undefined
  const runId = normalizeRunId()
  const { owner, repo } = context.repo
  const payload = context.payload as
    | IssueCommentEvent
    | IssuesEvent
    | PullRequestReviewCommentEvent
    | WorkflowDispatchEvent
    | WorkflowRunEvent
    | PullRequestEvent
  const issueEvent = isIssueCommentEvent(payload) ? payload : undefined
  const actor = eventFlags.isScheduleEvent ? undefined : context.actor
  const issueId = resolveIssueId(eventFlags.isRepoEvent, context.eventName, payload)
  const triggerCommentId = eventFlags.isCommentEvent
    ? (payload as IssueCommentEvent | PullRequestReviewCommentEvent).comment.id
    : undefined
  const commentType = resolveCommentType(eventFlags.isCommentEvent, context.eventName)
  const runUrl = `/${owner}/${repo}/actions/runs/${runId}`
  return {
    owner,
    repo,
    octoRest: null as unknown as Octokit,
    octoGraph: null as unknown as typeof graphql,
    appToken: "",
    session: null as unknown as { id: SessionID; title: string; version: string },
    providerID,
    modelID,
    variant,
    issueId,
    triggerCommentId,
    commentType,
    runUrl,
    actor,
    issueEvent,
    payload,
    isCommentEvent: eventFlags.isCommentEvent,
    eventName: context.eventName,
  }
}

async function initSession(ctx: RunCtx): Promise<void> {
  const repoData = await ctx.octoRest.rest.repos.get({ owner: ctx.owner, repo: ctx.repo })
  ctx.session = await Session.create({ permission: [{ permission: "question", action: "deny", pattern: "*" }] })
  subscribeSessionEvents(ctx.session.id)
  console.log("librecode session", ctx.session.id)
  ctx.defaultBranch = repoData.data.default_branch
}

// ---------------------------------------------------------------------------
// Event flag resolution
// ---------------------------------------------------------------------------

function resolveEventFlags(eventName: string): EventFlags {
  return {
    isUserEvent: USER_EVENTS.includes(eventName as UserEvent),
    isRepoEvent: REPO_EVENTS.includes(eventName as RepoEvent),
    isCommentEvent: ["issue_comment", "pull_request_review_comment"].includes(eventName),
    isIssuesEvent: eventName === "issues",
    isScheduleEvent: eventName === "schedule",
    isWorkflowDispatchEvent: eventName === "workflow_dispatch",
  }
}

function resolveIssueId(
  isRepoEvent: boolean,
  eventName: string,
  payload:
    | IssueCommentEvent
    | IssuesEvent
    | PullRequestReviewCommentEvent
    | WorkflowDispatchEvent
    | WorkflowRunEvent
    | PullRequestEvent,
): number | undefined {
  if (isRepoEvent) return undefined
  if (eventName === "issue_comment" || eventName === "issues") {
    return (payload as IssueCommentEvent | IssuesEvent).issue.number
  }
  return (payload as PullRequestEvent | PullRequestReviewCommentEvent).pull_request.number
}

function resolveCommentType(isCommentEvent: boolean, eventName: string): "issue" | "pr_review" | undefined {
  if (!isCommentEvent) return undefined
  return eventName === "pull_request_review_comment" ? "pr_review" : "issue"
}

// ---------------------------------------------------------------------------
// Environment variable normalizers
// ---------------------------------------------------------------------------

function normalizeModel(): { providerID: ProviderID; modelID: ModelID } {
  const value = process.env.MODEL
  if (!value) throw new Error(`Environment variable "MODEL" is not set`)
  const { providerID, modelID } = Provider.parseModel(value)
  if (!providerID.length || !modelID.length)
    throw new Error(`Invalid model ${value}. Model must be in the format "provider/model".`)
  return { providerID, modelID }
}

function normalizeRunId(): string {
  const value = process.env.GITHUB_RUN_ID
  if (!value) throw new Error(`Environment variable "GITHUB_RUN_ID" is not set`)
  return value
}

function normalizeUseGithubToken(): boolean {
  const value = process.env.USE_GITHUB_TOKEN
  if (!value) return false
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`Invalid use_github_token value: ${value}. Must be a boolean.`)
}

function normalizeOidcBaseUrl(): string {
  const value = process.env.OIDC_BASE_URL
  if (!value) return "https://api.librecode.ai"
  return value.replace(/\/+$/, "")
}

// ---------------------------------------------------------------------------
// Event type helpers
// ---------------------------------------------------------------------------

function isIssueCommentEvent(
  event:
    | IssueCommentEvent
    | IssuesEvent
    | PullRequestReviewCommentEvent
    | WorkflowDispatchEvent
    | WorkflowRunEvent
    | PullRequestEvent,
): event is IssueCommentEvent {
  return "issue" in event && "comment" in event
}

function getReviewCommentContext(
  eventName: string,
  payload:
    | IssueCommentEvent
    | IssuesEvent
    | PullRequestReviewCommentEvent
    | WorkflowDispatchEvent
    | WorkflowRunEvent
    | PullRequestEvent,
) {
  if (eventName !== "pull_request_review_comment") return null
  const reviewPayload = payload as PullRequestReviewCommentEvent
  return {
    file: reviewPayload.comment.path,
    diffHunk: reviewPayload.comment.diff_hunk,
    line: reviewPayload.comment.line,
    originalLine: reviewPayload.comment.original_line,
    position: reviewPayload.comment.position,
    commitId: reviewPayload.comment.commit_id,
    originalCommitId: reviewPayload.comment.original_commit_id,
  }
}

function parseMentions(raw: string | undefined): string[] {
  return (raw || "/librecode,/oc")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean)
}

function extractCommentPrompt(
  isCommentEvent: boolean,
  payload:
    | IssueCommentEvent
    | IssuesEvent
    | PullRequestReviewCommentEvent
    | WorkflowDispatchEvent
    | WorkflowRunEvent
    | PullRequestEvent,
  mentions: string[],
  reviewContext: ReturnType<typeof getReviewCommentContext>,
): string {
  if (!isCommentEvent) return "Review this pull request"

  const body = (payload as IssueCommentEvent | PullRequestReviewCommentEvent).comment.body.trim()
  const bodyLower = body.toLowerCase()

  if (mentions.some((m) => bodyLower === m)) {
    if (reviewContext) {
      return `Review this code change and suggest improvements for the commented lines:\n\nFile: ${reviewContext.file}\nLines: ${reviewContext.line}\n\n${reviewContext.diffHunk}`
    }
    return "Summarize this thread"
  }

  if (mentions.some((m) => bodyLower.includes(m))) {
    if (reviewContext) {
      return `${body}\n\nContext: You are reviewing a comment on file "${reviewContext.file}" at line ${reviewContext.line}.\n\nDiff context:\n${reviewContext.diffHunk}`
    }
    return body
  }

  throw new Error(`Comments must mention ${mentions.map((m) => `\`${m}\``).join(" or ")}`)
}

async function downloadPromptImages(
  prompt: string,
  appToken: string,
): Promise<{ prompt: string; files: PromptFile[] }> {
  const imgData: PromptFile[] = []
  const mdMatches = prompt.matchAll(/!?\[.*?\]\((https:\/\/github\.com\/user-attachments\/[^)]+)\)/gi)
  const tagMatches = prompt.matchAll(/<img .*?src="(https:\/\/github\.com\/user-attachments\/[^"]+)" \/>/gi)
  const matches = [...mdMatches, ...tagMatches].sort((a, b) => a.index - b.index)
  console.log("Images", JSON.stringify(matches, null, 2))

  let offset = 0
  for (const m of matches) {
    const tag = m[0]
    const url = m[1]
    const start = m.index
    const filename = path.basename(url)

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${appToken}`, Accept: "application/vnd.github.v3+json" },
    })
    if (!res.ok) {
      console.error(`Failed to download image: ${url}`)
      continue
    }

    const replacement = `@${filename}`
    prompt = prompt.slice(0, start + offset) + replacement + prompt.slice(start + offset + tag.length)
    offset += replacement.length - tag.length

    const contentType = res.headers.get("content-type")
    imgData.push({
      filename,
      mime: contentType?.startsWith("image/") ? contentType : "text/plain",
      content: Buffer.from(await res.arrayBuffer()).toString("base64"),
      start,
      end: start + replacement.length,
      replacement,
    })
  }

  return { prompt, files: imgData }
}

async function getUserPrompt(
  isRepoEvent: boolean,
  isIssuesEvent: boolean,
  isCommentEvent: boolean,
  payload:
    | IssueCommentEvent
    | IssuesEvent
    | PullRequestReviewCommentEvent
    | WorkflowDispatchEvent
    | WorkflowRunEvent
    | PullRequestEvent,
  appToken: string,
  eventName: string,
): Promise<{ userPrompt: string; promptFiles: PromptFile[] }> {
  const customPrompt = process.env.PROMPT
  // For repo events and issues events, PROMPT is required since there's no comment to extract from
  if (isRepoEvent || isIssuesEvent) {
    if (!customPrompt) {
      const eventType = isRepoEvent ? "scheduled and workflow_dispatch" : "issues"
      throw new Error(`PROMPT input is required for ${eventType} events`)
    }
    return { userPrompt: customPrompt, promptFiles: [] }
  }

  if (customPrompt) return { userPrompt: customPrompt, promptFiles: [] }

  const reviewContext = getReviewCommentContext(eventName, payload)
  const mentions = parseMentions(process.env.MENTIONS)
  const rawPrompt = extractCommentPrompt(isCommentEvent, payload, mentions, reviewContext)

  const { prompt, files } = await downloadPromptImages(rawPrompt, appToken)
  return { userPrompt: prompt, promptFiles: files }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Session event subscription
// ---------------------------------------------------------------------------

const SESSION_TOOL_LABELS: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

function printSessionEvent(color: string, type: string, title: string): void {
  UI.println(
    `${color}|`,
    `${UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM} ${type.padEnd(7, " ")}`,
    "",
    UI.Style.TEXT_NORMAL + title,
  )
}

type CompletedToolPart = MessageV2.Part & {
  type: "tool"
  state: { status: "completed"; title?: string; input: Record<string, unknown> }
}

function handleToolPart(part: CompletedToolPart): void {
  const [tool, color] = SESSION_TOOL_LABELS[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
  const title =
    part.state.title || Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown"
  console.log()
  printSessionEvent(color, tool, title)
}

function handleTextPart(part: MessageV2.Part & { type: "text" }, textRef: { value: string }): void {
  textRef.value = part.text
  if (part.time?.end) {
    UI.empty()
    UI.println(UI.markdown(textRef.value))
    UI.empty()
    textRef.value = ""
  }
}

function subscribeSessionEvents(sessionId: SessionID): void {
  const textRef = { value: "" }
  Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
    if (evt.properties.part.sessionID !== sessionId) return
    const part = evt.properties.part
    if (part.type === "tool" && part.state.status === "completed") handleToolPart(part as CompletedToolPart)
    if (part.type === "text") handleTextPart(part, textRef)
  })
}

// ---------------------------------------------------------------------------
// Chat / summarize
// ---------------------------------------------------------------------------

function buildChatParts(message: string, files: PromptFile[]) {
  return [
    { id: PartID.ascending(), type: "text" as const, text: message },
    ...files.flatMap((f) => [
      {
        id: PartID.ascending(),
        type: "file" as const,
        mime: f.mime,
        url: `data:${f.mime};base64,${f.content}`,
        filename: f.filename,
        source: {
          type: "file" as const,
          text: { value: f.replacement, start: f.start, end: f.end },
          path: f.filename,
        },
      },
    ]),
  ]
}

function throwAgentError(err: { name: string; data?: { message?: string } }, files: PromptFile[]): never {
  console.error("Agent error:", err)
  if (err.name === "ContextOverflowError") throw new Error(formatPromptTooLargeError(files))
  throw new Error(`${err.name}: ${err.data?.message || ""}`)
}

async function chat(ctx: RunCtx, message: string, files: PromptFile[] = []): Promise<string> {
  console.log("Sending message to librecode...")

  const result = await SessionPrompt.prompt({
    sessionID: ctx.session.id,
    messageID: MessageID.ascending(),
    variant: ctx.variant,
    model: { providerID: ctx.providerID, modelID: ctx.modelID },
    // agent is omitted - server will use default_agent from config or fall back to "build"
    parts: buildChatParts(message, files),
  })

  if (result.info.role === "assistant" && result.info.error) {
    throwAgentError(result.info.error, files)
  }

  const text = extractResponseText(result.parts)
  if (text) return text

  // No text part (tool-only or reasoning-only) — ask agent to summarize
  console.log("Requesting summary from agent...")
  const summary = await SessionPrompt.prompt({
    sessionID: ctx.session.id,
    messageID: MessageID.ascending(),
    variant: ctx.variant,
    model: { providerID: ctx.providerID, modelID: ctx.modelID },
    tools: { "*": false }, // Disable all tools to force text response
    parts: [
      {
        id: PartID.ascending(),
        type: "text",
        text: "Summarize the actions (tool calls & reasoning) you did for the user in 1-2 sentences.",
      },
    ],
  })

  if (summary.info.role === "assistant" && summary.info.error) {
    throwAgentError(summary.info.error, files)
  }

  const summaryText = extractResponseText(summary.parts)
  if (!summaryText) throw new Error("Failed to get summary from agent")

  return summaryText
}

async function summarize(ctx: RunCtx, response: string): Promise<string> {
  try {
    return await chat(ctx, `Summarize the following in less than 40 characters:\n\n${response}`)
  } catch {
    const title = ctx.issueEvent
      ? ctx.issueEvent.issue.title
      : (ctx.payload as PullRequestReviewCommentEvent).pull_request.title
    return `Fix issue: ${title}`
  }
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function getOidcToken(): Promise<string> {
  try {
    return await core.getIDToken("librecode-github-action")
  } catch (error) {
    console.error("Failed to get OIDC token:", error instanceof Error ? error.message : error)
    throw new Error("Could not fetch an OIDC token. Make sure to add `id-token: write` to your workflow permissions.")
  }
}

async function exchangeForAppToken(oidcBaseUrl: string, owner: string, repo: string, token: string): Promise<string> {
  const response = token.startsWith("github_pat_")
    ? await fetch(`${oidcBaseUrl}/exchange_github_app_token_with_pat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ owner, repo }),
      })
    : await fetch(`${oidcBaseUrl}/exchange_github_app_token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })

  if (!response.ok) {
    const responseJson = (await response.json()) as { error?: string }
    throw new Error(`App token exchange failed: ${response.status} ${response.statusText} - ${responseJson.error}`)
  }

  const responseJson = (await response.json()) as { token: string }
  return responseJson.token
}

async function resolveAppToken(
  useGithubToken: boolean,
  isMock: boolean,
  mockToken: string | undefined,
  oidcBaseUrl: string,
  owner: string,
  repo: string,
): Promise<string> {
  if (useGithubToken) {
    const githubToken = process.env.GITHUB_TOKEN
    if (!githubToken) {
      throw new Error(
        "GITHUB_TOKEN environment variable is not set. When using use_github_token, you must provide GITHUB_TOKEN.",
      )
    }
    return githubToken
  }
  const actionToken = isMock ? (mockToken ?? "") : await getOidcToken()
  return exchangeForAppToken(oidcBaseUrl, owner, repo, actionToken)
}

// ---------------------------------------------------------------------------
// Git config + auth helpers (use AGENT_USERNAME, stay in run.ts)
// ---------------------------------------------------------------------------

async function configureGit(appToken: string, isMock: boolean): Promise<string | undefined> {
  // Do not change git config when running locally
  if (isMock) return undefined

  console.log("Configuring git...")
  const config = "http.https://github.com/.extraheader"
  // actions/checkout@v6 no longer stores credentials in .git/config,
  // so this may not exist - use nothrow() to handle gracefully
  const ret = await gitStatus(["config", "--local", "--get", config])
  let savedConfig: string | undefined
  if (ret.exitCode === 0) {
    savedConfig = ret.stdout.toString().trim()
    await gitRun(["config", "--local", "--unset-all", config])
  }

  const newCredentials = Buffer.from(`x-access-token:${appToken}`, "utf8").toString("base64")
  await gitRun(["config", "--local", config, `AUTHORIZATION: basic ${newCredentials}`])
  await gitRun(["config", "--global", "user.name", AGENT_USERNAME])
  await gitRun(["config", "--global", "user.email", `${AGENT_USERNAME}@users.noreply.github.com`])
  return savedConfig
}

async function restoreGitConfig(savedConfig: string | undefined): Promise<void> {
  if (savedConfig === undefined) return
  const config = "http.https://github.com/.extraheader"
  await gitRun(["config", "--local", config, savedConfig])
}

async function revokeAppToken(appToken: string | undefined): Promise<void> {
  if (!appToken) return
  await fetch("https://api.github.com/installation/token", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${appToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
}

function buildFooter(ctx: RunCtx): string {
  return `\n\n[github run](${ctx.runUrl})`
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function formatErrorMessage(e: unknown): string {
  if (e instanceof Process.RunFailedError) return e.stderr.toString()
  if (e instanceof Error) return e.message
  return String(e)
}

// ---------------------------------------------------------------------------
// Event dispatching
// ---------------------------------------------------------------------------

async function dispatchEvent(
  ctx: RunCtx,
  userPrompt: string,
  promptFiles: PromptFile[],
  flags: EventFlags,
): Promise<void> {
  const isPR =
    ["pull_request", "pull_request_review_comment"].includes(ctx.eventName) || ctx.issueEvent?.issue.pull_request
  if (flags.isRepoEvent) {
    if (!ctx.defaultBranch) throw new Error("defaultBranch is not set for repo event")
    await handleRepoEvent(
      ctx,
      userPrompt,
      promptFiles,
      ctx.defaultBranch,
      flags.isWorkflowDispatchEvent,
      flags.isScheduleEvent,
    )
  } else if (isPR) {
    await handlePREvent(ctx, userPrompt, promptFiles, ctx.commentType)
  } else {
    if (!ctx.defaultBranch) throw new Error("defaultBranch is not set for issue event")
    await handleIssueEvent(ctx, userPrompt, promptFiles, ctx.defaultBranch, ctx.commentType)
  }
}

async function handleRepoEvent(
  ctx: RunCtx,
  userPrompt: string,
  promptFiles: PromptFile[],
  defaultBranch: string,
  isWorkflowDispatchEvent: boolean,
  isScheduleEvent: boolean,
): Promise<void> {
  if (isWorkflowDispatchEvent && ctx.actor) {
    console.log(`Triggered by: ${ctx.actor}`)
  }
  const branchPrefix = isWorkflowDispatchEvent ? "dispatch" : "schedule"
  const branch = await checkoutNewBranch(branchPrefix, ctx.issueId)
  const head = await gitText(["rev-parse", "HEAD"])
  const response = await chat(ctx, userPrompt, promptFiles)
  const { dirty, uncommittedChanges, switched } = await branchIsDirty(head, branch)

  if (switched) {
    console.log("Agent managed its own branch, skipping infrastructure push/PR")
    console.log("Response:", response)
  } else if (dirty) {
    const summary = await summarize(ctx, response)
    await pushToNewBranch(summary, branch, uncommittedChanges, isScheduleEvent, ctx.actor)
    const triggerType = isWorkflowDispatchEvent ? "workflow_dispatch" : "scheduled workflow"
    const pr = await createPR(
      ctx.octoRest,
      ctx.owner,
      ctx.repo,
      defaultBranch,
      branch,
      summary,
      `${response}\n\nTriggered by ${triggerType}${buildFooter(ctx)}`,
    )
    if (pr) {
      console.log(`Created PR #${pr}`)
    } else {
      console.log("Skipped PR creation (no new commits)")
    }
  } else {
    console.log("Response:", response)
  }
}

async function handleLocalPREvent(
  ctx: RunCtx,
  prData: GitHubPullRequest,
  userPrompt: string,
  promptFiles: PromptFile[],
  commentType: "issue" | "pr_review" | undefined,
): Promise<void> {
  await checkoutLocalBranch(prData)
  const head = await gitText(["rev-parse", "HEAD"])
  const dataPrompt = buildPromptDataForPR(prData, ctx.triggerCommentId)
  const response = await chat(ctx, `${userPrompt}\n\n${dataPrompt}`, promptFiles)
  const { dirty, uncommittedChanges, switched } = await branchIsDirty(head, prData.headRefName)
  if (switched) {
    console.log("Agent managed its own branch, skipping infrastructure push")
  }
  if (dirty && !switched) {
    const summary = await summarize(ctx, response)
    await pushToLocalBranch(summary, uncommittedChanges, ctx.actor)
  }
  if (ctx.issueId === undefined) throw new Error("issueId is required for PR event")
  await createComment(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, `${response}${buildFooter(ctx)}`)
  await removeReaction(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, ctx.triggerCommentId, commentType)
}

async function handleForkPREvent(
  ctx: RunCtx,
  prData: GitHubPullRequest,
  userPrompt: string,
  promptFiles: PromptFile[],
  commentType: "issue" | "pr_review" | undefined,
): Promise<void> {
  const forkBranch = await checkoutForkBranch(prData, ctx.issueId)
  const head = await gitText(["rev-parse", "HEAD"])
  const dataPrompt = buildPromptDataForPR(prData, ctx.triggerCommentId)
  const response = await chat(ctx, `${userPrompt}\n\n${dataPrompt}`, promptFiles)
  const { dirty, uncommittedChanges, switched } = await branchIsDirty(head, forkBranch)
  if (switched) {
    console.log("Agent managed its own branch, skipping infrastructure push")
  }
  if (dirty && !switched) {
    const summary = await summarize(ctx, response)
    await pushToForkBranch(summary, prData, uncommittedChanges, ctx.actor)
  }
  if (ctx.issueId === undefined) throw new Error("issueId is required for fork PR event")
  await createComment(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, `${response}${buildFooter(ctx)}`)
  await removeReaction(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, ctx.triggerCommentId, commentType)
}

async function handlePREvent(
  ctx: RunCtx,
  userPrompt: string,
  promptFiles: PromptFile[],
  commentType: "issue" | "pr_review" | undefined,
): Promise<void> {
  const prData = await fetchPR(ctx.octoGraph, ctx.owner, ctx.repo, ctx.issueId)
  if (prData.headRepository.nameWithOwner === prData.baseRepository.nameWithOwner) {
    await handleLocalPREvent(ctx, prData, userPrompt, promptFiles, commentType)
  } else {
    await handleForkPREvent(ctx, prData, userPrompt, promptFiles, commentType)
  }
}

async function handleIssueEvent(
  ctx: RunCtx,
  userPrompt: string,
  promptFiles: PromptFile[],
  defaultBranch: string,
  commentType: "issue" | "pr_review" | undefined,
): Promise<void> {
  const branch = await checkoutNewBranch("issue", ctx.issueId)
  const head = await gitText(["rev-parse", "HEAD"])
  const issueData = await fetchIssue(ctx.octoGraph, ctx.owner, ctx.repo, ctx.issueId)
  const dataPrompt = buildPromptDataForIssue(issueData, ctx.triggerCommentId)
  const response = await chat(ctx, `${userPrompt}\n\n${dataPrompt}`, promptFiles)
  const { dirty, uncommittedChanges, switched } = await branchIsDirty(head, branch)

  if (ctx.issueId === undefined) throw new Error("issueId is required for issue event")
  if (switched) {
    // Agent switched branches (likely created its own branch/PR).
    // Don't push the stale infrastructure branch — just comment.
    await createComment(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, `${response}${buildFooter(ctx)}`)
    await removeReaction(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, ctx.triggerCommentId, commentType)
  } else if (dirty) {
    const summary = await summarize(ctx, response)
    await pushToNewBranch(summary, branch, uncommittedChanges, false, ctx.actor)
    const pr = await createPR(
      ctx.octoRest,
      ctx.owner,
      ctx.repo,
      defaultBranch,
      branch,
      summary,
      `${response}\n\nCloses #${ctx.issueId}${buildFooter(ctx)}`,
    )
    if (pr) {
      await createComment(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, `Created PR #${pr}${buildFooter(ctx)}`)
    } else {
      await createComment(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, `${response}${buildFooter(ctx)}`)
    }
    await removeReaction(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, ctx.triggerCommentId, commentType)
  } else {
    await createComment(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, `${response}${buildFooter(ctx)}`)
    await removeReaction(ctx.octoRest, ctx.owner, ctx.repo, ctx.issueId, ctx.triggerCommentId, commentType)
  }
}
