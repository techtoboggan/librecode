import { Instance } from "@/project/instance"
import { Process } from "@/util/process"
import { git } from "@/util/git"
import type { GitHubPullRequest } from "./queries"

// ---------------------------------------------------------------------------
// Low-level git wrappers
// ---------------------------------------------------------------------------

export async function gitText(args: string[]): Promise<string> {
  const result = await git(args, { cwd: Instance.worktree })
  if (result.exitCode !== 0) {
    throw new Process.RunFailedError(["git", ...args], result.exitCode, result.stdout, result.stderr)
  }
  return result.text().trim()
}

export async function gitRun(args: string[]) {
  const result = await git(args, { cwd: Instance.worktree })
  if (result.exitCode !== 0) {
    throw new Process.RunFailedError(["git", ...args], result.exitCode, result.stdout, result.stderr)
  }
  return result
}

export function gitStatus(args: string[]) {
  return git(args, { cwd: Instance.worktree })
}

export async function commitChanges(summary: string, actor?: string): Promise<void> {
  const args = ["commit", "-m", summary]
  if (actor) args.push("-m", `Co-authored-by: ${actor} <${actor}@users.noreply.github.com>`)
  await gitRun(args)
}

// ---------------------------------------------------------------------------
// Branch helpers
// ---------------------------------------------------------------------------

export function generateBranchName(
  type: "issue" | "pr" | "schedule" | "dispatch",
  issueId: number | undefined,
): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}Z/, "")
    .split("T")
    .join("")
  if (type === "schedule" || type === "dispatch") {
    const hex = crypto.randomUUID().slice(0, 6)
    return `librecode/${type}-${hex}-${timestamp}`
  }
  return `librecode/${type}${issueId}-${timestamp}`
}

export async function checkoutNewBranch(
  type: "issue" | "schedule" | "dispatch",
  issueId: number | undefined,
): Promise<string> {
  console.log("Checking out new branch...")
  const branch = generateBranchName(type, issueId)
  await gitRun(["checkout", "-b", branch])
  return branch
}

export async function checkoutLocalBranch(pr: GitHubPullRequest): Promise<void> {
  console.log("Checking out local branch...")
  const branch = pr.headRefName
  const depth = Math.max(pr.commits.totalCount, 20)
  await gitRun(["fetch", "origin", `--depth=${depth}`, branch])
  await gitRun(["checkout", branch])
}

export async function checkoutForkBranch(pr: GitHubPullRequest, issueId: number | undefined): Promise<string> {
  console.log("Checking out fork branch...")
  const remoteBranch = pr.headRefName
  const localBranch = generateBranchName("pr", issueId)
  const depth = Math.max(pr.commits.totalCount, 20)
  await gitRun(["remote", "add", "fork", `https://github.com/${pr.headRepository.nameWithOwner}.git`])
  await gitRun(["fetch", "fork", `--depth=${depth}`, remoteBranch])
  await gitRun(["checkout", "-b", localBranch, `fork/${remoteBranch}`])
  return localBranch
}

export async function pushToNewBranch(
  summary: string,
  branch: string,
  commit: boolean,
  isSchedule: boolean,
  actor: string | undefined,
): Promise<void> {
  console.log("Pushing to new branch...")
  if (commit) {
    await gitRun(["add", "."])
    await commitChanges(summary, isSchedule ? undefined : actor)
  }
  await gitRun(["push", "-u", "origin", branch])
}

export async function pushToLocalBranch(summary: string, commit: boolean, actor: string | undefined): Promise<void> {
  console.log("Pushing to local branch...")
  if (commit) {
    await gitRun(["add", "."])
    await commitChanges(summary, actor)
  }
  await gitRun(["push"])
}

export async function pushToForkBranch(
  summary: string,
  pr: GitHubPullRequest,
  commit: boolean,
  actor: string | undefined,
): Promise<void> {
  console.log("Pushing to fork branch...")
  if (commit) {
    await gitRun(["add", "."])
    await commitChanges(summary, actor)
  }
  await gitRun(["push", "fork", `HEAD:${pr.headRefName}`])
}

export async function branchIsDirty(
  originalHead: string,
  expectedBranch: string,
): Promise<{ dirty: boolean; uncommittedChanges: boolean; switched: boolean }> {
  console.log("Checking if branch is dirty...")
  // Detect if the agent switched branches during chat (e.g. created
  // its own branch, committed, and possibly pushed/created a PR).
  const current = await gitText(["rev-parse", "--abbrev-ref", "HEAD"])
  if (current !== expectedBranch) {
    console.log(`Branch changed during chat: expected ${expectedBranch}, now on ${current}`)
    return { dirty: true, uncommittedChanges: false, switched: true }
  }

  const ret = await gitStatus(["status", "--porcelain"])
  const status = ret.stdout.toString().trim()
  if (status.length > 0) return { dirty: true, uncommittedChanges: true, switched: false }

  const head = await gitText(["rev-parse", "HEAD"])
  return { dirty: head !== originalHead, uncommittedChanges: false, switched: false }
}

// Verify commits exist between base ref and a branch using rev-list.
// Falls back to fetching from origin when local refs are missing
// (common in shallow clones from actions/checkout).
export async function hasNewCommits(base: string, head: string): Promise<boolean> {
  const result = await gitStatus(["rev-list", "--count", `${base}..${head}`])
  if (result.exitCode !== 0) {
    console.log(`rev-list failed, fetching origin/${base}...`)
    await gitStatus(["fetch", "origin", base, "--depth=1"])
    const retry = await gitStatus(["rev-list", "--count", `origin/${base}..${head}`])
    if (retry.exitCode !== 0) return true // assume dirty if we can't tell
    return parseInt(retry.stdout.toString().trim()) > 0
  }
  return parseInt(result.stdout.toString().trim()) > 0
}
