import { UI } from "../../ui"
import { Process } from "@/util/process"
import { git } from "@/util/git"
import { Instance } from "@/project/instance"
import { spawn } from "child_process"

export async function checkoutPrBranch(prNumber: number, localBranchName: string): Promise<boolean> {
  UI.println(`Fetching and checking out PR #${prNumber}...`)
  const result = await Process.run(
    ["gh", "pr", "checkout", `${prNumber}`, "--branch", localBranchName, "--force"],
    { nothrow: true },
  )
  if (result.code !== 0) {
    UI.error(`Failed to checkout PR #${prNumber}. Make sure you have gh CLI installed and authenticated.`)
    return false
  }
  return true
}

export async function fetchPrInfo(prNumber: number): Promise<Record<string, unknown> | null> {
  const result = await Process.text(
    ["gh", "pr", "view", `${prNumber}`, "--json", "headRepository,headRepositoryOwner,isCrossRepository,headRefName,body"],
    { nothrow: true },
  )
  if (result.code !== 0 || !result.text.trim()) return null
  return JSON.parse(result.text) as Record<string, unknown>
}

export async function configureForkRemote(
  prInfo: Record<string, unknown>,
  localBranchName: string,
): Promise<void> {
  const repo = prInfo.headRepository as { name: string } | undefined
  const owner = prInfo.headRepositoryOwner as { login: string } | undefined
  if (!prInfo.isCrossRepository || !repo || !owner) return

  const forkOwner = owner.login
  const forkName = repo.name
  const headRefName = prInfo.headRefName as string
  const remotes = (await git(["remote"], { cwd: Instance.worktree })).text().trim()

  if (!remotes.split("\n").includes(forkOwner)) {
    await git(["remote", "add", forkOwner, `https://github.com/${forkOwner}/${forkName}.git`], {
      cwd: Instance.worktree,
    })
    UI.println(`Added fork remote: ${forkOwner}`)
  }

  await git(["branch", `--set-upstream-to=${forkOwner}/${headRefName}`, localBranchName], {
    cwd: Instance.worktree,
  })
}

export async function importPrSession(prBody: unknown): Promise<string | undefined> {
  if (typeof prBody !== "string") return undefined
  const sessionMatch = prBody.match(/https:\/\/opncd\.ai\/s\/([a-zA-Z0-9_-]+)/)
  if (!sessionMatch) return undefined

  UI.println(`Found librecode session: ${sessionMatch[0]}`)
  UI.println("Importing session...")
  const importResult = await Process.text(["librecode", "import", sessionMatch[0]], { nothrow: true })
  if (importResult.code !== 0) return undefined

  const sessionIdMatch = importResult.text.trim().match(/Imported session: ([a-zA-Z0-9_-]+)/)
  if (sessionIdMatch) {
    UI.println(`Session imported: ${sessionIdMatch[1]}`)
    return sessionIdMatch[1]
  }
  return undefined
}

export async function launchLibrecode(sessionId?: string): Promise<void> {
  UI.println("Starting librecode...")
  UI.println()
  const librecodeArgs = sessionId ? ["-s", sessionId] : []
  const librecodeProcess = spawn("librecode", librecodeArgs, { stdio: "inherit", cwd: process.cwd() })
  await new Promise<void>((resolve, reject) => {
    librecodeProcess.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`librecode exited with code ${code}`))
    })
    librecodeProcess.on("error", reject)
  })
}
