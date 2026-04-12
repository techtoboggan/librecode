import { setTimeout as sleep } from "node:timers/promises"
import type { Octokit } from "@octokit/rest"
import { hasNewCommits } from "./git-helpers"

// These constants are shared with run.ts for git config
export const AGENT_USERNAME = "librecode-agent[bot]"
export const AGENT_REACTION = "eyes"

export async function assertPermissions(
  octoRest: Octokit,
  owner: string,
  repo: string,
  actor: string | undefined,
): Promise<void> {
  console.log(`Asserting permissions for user ${actor}...`)
  let permission: string
  try {
    const response = await octoRest.repos.getCollaboratorPermissionLevel({ owner, repo, username: actor! })
    permission = response.data.permission
    console.log(`  permission: ${permission}`)
  } catch (error) {
    console.error(`Failed to check permissions: ${error}`)
    throw new Error(`Failed to check permissions for user ${actor}: ${error}`)
  }
  if (!["admin", "write"].includes(permission)) throw new Error(`User ${actor} does not have write permissions`)
}

export async function addReaction(
  octoRest: Octokit,
  owner: string,
  repo: string,
  issueId: number | undefined,
  triggerCommentId: number | undefined,
  commentType: "issue" | "pr_review" | undefined,
) {
  console.log("Adding reaction...")
  if (triggerCommentId) {
    if (commentType === "pr_review") {
      return await octoRest.rest.reactions.createForPullRequestReviewComment({
        owner,
        repo,
        comment_id: triggerCommentId,
        content: AGENT_REACTION,
      })
    }
    return await octoRest.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: triggerCommentId,
      content: AGENT_REACTION,
    })
  }
  return await octoRest.rest.reactions.createForIssue({
    owner,
    repo,
    issue_number: issueId!,
    content: AGENT_REACTION,
  })
}

async function removeReactionForPRReview(octoRest: Octokit, owner: string, repo: string, triggerCommentId: number) {
  const reactions = await octoRest.rest.reactions.listForPullRequestReviewComment({
    owner,
    repo,
    comment_id: triggerCommentId,
    content: AGENT_REACTION,
  })
  const eyesReaction = reactions.data.find((r) => r.user?.login === AGENT_USERNAME)
  if (!eyesReaction) return
  return await octoRest.rest.reactions.deleteForPullRequestComment({
    owner,
    repo,
    comment_id: triggerCommentId,
    reaction_id: eyesReaction.id,
  })
}

async function removeReactionForIssueComment(octoRest: Octokit, owner: string, repo: string, triggerCommentId: number) {
  const reactions = await octoRest.rest.reactions.listForIssueComment({
    owner,
    repo,
    comment_id: triggerCommentId,
    content: AGENT_REACTION,
  })
  const eyesReaction = reactions.data.find((r) => r.user?.login === AGENT_USERNAME)
  if (!eyesReaction) return
  return await octoRest.rest.reactions.deleteForIssueComment({
    owner,
    repo,
    comment_id: triggerCommentId,
    reaction_id: eyesReaction.id,
  })
}

export async function removeReaction(
  octoRest: Octokit,
  owner: string,
  repo: string,
  issueId: number | undefined,
  triggerCommentId: number | undefined,
  commentType: "issue" | "pr_review" | undefined,
) {
  console.log("Removing reaction...")
  if (triggerCommentId) {
    if (commentType === "pr_review") return removeReactionForPRReview(octoRest, owner, repo, triggerCommentId)
    return removeReactionForIssueComment(octoRest, owner, repo, triggerCommentId)
  }

  const reactions = await octoRest.rest.reactions.listForIssue({
    owner,
    repo,
    issue_number: issueId!,
    content: AGENT_REACTION,
  })
  const eyesReaction = reactions.data.find((r) => r.user?.login === AGENT_USERNAME)
  if (!eyesReaction) return
  await octoRest.rest.reactions.deleteForIssue({
    owner,
    repo,
    issue_number: issueId!,
    reaction_id: eyesReaction.id,
  })
}

export async function createComment(octoRest: Octokit, owner: string, repo: string, issueId: number, body: string) {
  console.log("Creating comment...")
  return await octoRest.rest.issues.createComment({ owner, repo, issue_number: issueId, body })
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 5000): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (retries > 0) {
      console.log(`Retrying after ${delayMs}ms...`)
      await sleep(delayMs)
      return withRetry(fn, retries - 1, delayMs)
    }
    throw e
  }
}

export async function createPR(
  octoRest: Octokit,
  owner: string,
  repo: string,
  base: string,
  branch: string,
  title: string,
  body: string,
): Promise<number | null> {
  console.log("Creating pull request...")

  // Check if an open PR already exists for this head→base combination
  try {
    const existing = await withRetry(() =>
      octoRest.rest.pulls.list({ owner, repo, head: `${owner}:${branch}`, base, state: "open" }),
    )
    if (existing.data.length > 0) {
      console.log(`PR #${existing.data[0].number} already exists for branch ${branch}`)
      return existing.data[0].number
    }
  } catch (e) {
    console.log(`Failed to check for existing PR: ${e}`)
  }

  // Verify there are commits between base and head before creating the PR.
  // In shallow clones, the branch can appear dirty but share the same
  // commit as the base, causing a 422 from GitHub.
  if (!(await hasNewCommits(base, branch))) {
    console.log(`No commits between ${base} and ${branch}, skipping PR creation`)
    return null
  }

  try {
    const pr = await withRetry(() => octoRest.rest.pulls.create({ owner, repo, head: branch, base, title, body }))
    return pr.data.number
  } catch (e: unknown) {
    // Handle "No commits between X and Y" validation error from GitHub.
    if (e instanceof Error && e.message.includes("No commits between")) {
      console.log(`GitHub rejected PR: ${e.message}`)
      return null
    }
    throw e
  }
}
