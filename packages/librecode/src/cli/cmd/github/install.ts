import path from "path"
import { exec } from "child_process"
import { Filesystem } from "../../../util/filesystem"
import * as prompts from "@clack/prompts"
import { map, pipe, sortBy, values } from "remeda"
import { UI } from "../../ui"
import { cmd } from "../cmd"
import { ModelsDev } from "../../../provider/models"
import { Instance } from "@/project/instance"
import { setTimeout as sleep } from "node:timers/promises"
import { git } from "@/util/git"
import { parseGitHubRemote } from "./util"

const WORKFLOW_FILE = ".github/workflows/librecode.yml"

async function fetchGitHubAppInstallation(owner: string, repo: string): Promise<unknown> {
  return await fetch(`https://api.librecode.ai/get_github_app_installation?owner=${owner}&repo=${repo}`)
    .then((res) => res.json())
    .then((data: { installation?: unknown }) => data.installation)
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`
  exec(command, (error) => {
    if (error) {
      prompts.log.warn(`Could not open browser. Please visit: ${url}`)
    }
  })
}

async function pollForGitHubAppInstallation(
  owner: string,
  repo: string,
  s: ReturnType<typeof prompts.spinner>,
): Promise<void> {
  const MAX_RETRIES = 120
  let retries = 0
  do {
    const installation = await fetchGitHubAppInstallation(owner, repo)
    if (installation) return

    if (retries > MAX_RETRIES) {
      s.stop(
        `Failed to detect GitHub app installation. Make sure to install the app for the \`${owner}/${repo}\` repository.`,
      )
      throw new UI.CancelledError()
    }

    retries++
    await sleep(1000)
  } while (true)
}

export const GithubInstallCommand = cmd({
  command: "install",
  describe: "install the GitHub agent",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        {
          UI.empty()
          prompts.intro("Install GitHub agent")
          const app = await getAppInfo()
          await installGitHubApp()

          const providers = await ModelsDev.get().then((p) => {
            // TODO: add guide for copilot, for now just hide it
            delete p["github-copilot"]
            return p
          })

          const provider = await promptProvider()
          const model = await promptModel()
          //const key = await promptKey()

          await addWorkflowFiles()
          printNextSteps()

          function printNextSteps() {
            let step2
            if (provider === "amazon-bedrock") {
              step2 =
                "Configure OIDC in AWS - https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services"
            } else {
              step2 = [
                `    2. Add the following secrets in org or repo (${app.owner}/${app.repo}) settings`,
                "",
                ...providers[provider].env.map((e) => `       - ${e}`),
              ].join("\n")
            }

            prompts.outro(
              [
                "Next steps:",
                "",
                `    1. Commit the \`${WORKFLOW_FILE}\` file and push`,
                step2,
                "",
                "    3. Go to a GitHub issue and comment `/oc summarize` to see the agent in action",
                "",
                "   Learn more about the GitHub agent - https://github.com/techtoboggan/librecode/docs/github/#usage-examples",
              ].join("\n"),
            )
          }

          async function getAppInfo() {
            const project = Instance.project
            if (project.vcs !== "git") {
              prompts.log.error(`Could not find git repository. Please run this command from a git repository.`)
              throw new UI.CancelledError()
            }

            // Get repo info
            const info = (await git(["remote", "get-url", "origin"], { cwd: Instance.worktree })).text().trim()
            const parsed = parseGitHubRemote(info)
            if (!parsed) {
              prompts.log.error(`Could not find git repository. Please run this command from a git repository.`)
              throw new UI.CancelledError()
            }
            return { owner: parsed.owner, repo: parsed.repo, root: Instance.worktree }
          }

          async function promptProvider() {
            const priority: Record<string, number> = {
              librecode: 0,
              anthropic: 1,
              openai: 2,
              google: 3,
            }
            let provider = await prompts.select({
              message: "Select provider",
              maxItems: 8,
              options: pipe(
                providers,
                values(),
                sortBy(
                  (x) => priority[x.id] ?? 99,
                  (x) => x.name ?? x.id,
                ),
                map((x) => ({
                  label: x.name,
                  value: x.id,
                  hint: priority[x.id] === 0 ? "recommended" : undefined,
                })),
              ),
            })

            if (prompts.isCancel(provider)) throw new UI.CancelledError()

            return provider
          }

          async function promptModel() {
            const providerData = providers[provider]!

            const model = await prompts.select({
              message: "Select model",
              maxItems: 8,
              options: pipe(
                providerData.models,
                values(),
                sortBy((x) => x.name ?? x.id),
                map((x) => ({
                  label: x.name ?? x.id,
                  value: x.id,
                })),
              ),
            })

            if (prompts.isCancel(model)) throw new UI.CancelledError()
            return model
          }

          async function installGitHubApp() {
            const s = prompts.spinner()
            s.start("Installing GitHub app")

            // Get installation
            const installation = await fetchGitHubAppInstallation(app.owner, app.repo)
            if (installation) return s.stop("GitHub app already installed")

            // Open browser
            openBrowser("https://github.com/apps/librecode-agent")

            // Wait for installation
            s.message("Waiting for GitHub app to be installed")
            await pollForGitHubAppInstallation(app.owner, app.repo, s)

            s.stop("Installed GitHub app")
          }

          async function addWorkflowFiles() {
            const envStr =
              provider === "amazon-bedrock"
                ? ""
                : `\n        env:${providers[provider].env.map((e) => `\n          ${e}: \${{ secrets.${e} }}`).join("")}`

            await Filesystem.write(
              path.join(app.root, WORKFLOW_FILE),
              `name: librecode

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  librecode:
    if: |
      contains(github.event.comment.body, ' /oc') ||
      startsWith(github.event.comment.body, '/oc') ||
      contains(github.event.comment.body, ' /librecode') ||
      startsWith(github.event.comment.body, '/librecode')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: read
      issues: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Run librecode
        uses: anomalyco/librecode/github@latest${envStr}
        with:
          model: ${provider}/${model}`,
            )

            prompts.log.success(`Added workflow file: "${WORKFLOW_FILE}"`)
          }
        }
      },
    })
  },
})
