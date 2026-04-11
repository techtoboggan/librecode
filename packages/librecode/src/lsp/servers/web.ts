import path from "path"
import { spawn as launch, type ChildProcessWithoutNullStreams } from "child_process"
import { Module } from "@librecode/util/module"
import {
  BunProc,
  Global,
  Filesystem,
  Instance,
  Flag,
  Process,
  which,
  log,
  downloadEslintServer,
  resolveOxlintLspBin,
} from "../install"

const spawn = ((cmd, args, opts) => {
  if (Array.isArray(args)) return launch(cmd, [...args], { ...(opts ?? {}), windowsHide: true })
  return launch(cmd, { ...(args ?? {}), windowsHide: true })
}) as typeof launch

export interface Handle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, unknown>
}

type RootFunction = (file: string) => Promise<string | undefined>

export const NearestRoot = (includePatterns: string[], excludePatterns?: string[]): RootFunction => {
  return async (file) => {
    if (excludePatterns) {
      const excludedFiles = Filesystem.up({
        targets: excludePatterns,
        start: path.dirname(file),
        stop: Instance.directory,
      })
      const excluded = await excludedFiles.next()
      await excludedFiles.return()
      if (excluded.value) return undefined
    }
    const files = Filesystem.up({
      targets: includePatterns,
      start: path.dirname(file),
      stop: Instance.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return Instance.directory
    return path.dirname(first.value)
  }
}

export interface Info {
  id: string
  extensions: string[]
  global?: boolean
  root: RootFunction
  spawn(root: string): Promise<Handle | undefined>
}

export const Deno: Info = {
  id: "deno",
  root: async (file) => {
    const files = Filesystem.up({
      targets: ["deno.json", "deno.jsonc"],
      start: path.dirname(file),
      stop: Instance.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return undefined
    return path.dirname(first.value)
  },
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  async spawn(root) {
    const deno = which("deno")
    if (!deno) {
      log.info("deno not found, please install deno first")
      return
    }
    return {
      process: spawn(deno, ["lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Typescript: Info = {
  id: "typescript",
  root: NearestRoot(
    ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
    ["deno.json", "deno.jsonc"],
  ),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  async spawn(root) {
    const tsserver = Module.resolve("typescript/lib/tsserver.js", Instance.directory)
    log.info("typescript server", { tsserver })
    if (!tsserver) return
    const proc = spawn(BunProc.which(), ["x", "typescript-language-server", "--stdio"], {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization: {
        tsserver: {
          path: tsserver,
        },
      },
    }
  },
}

export const Vue: Info = {
  id: "vue",
  extensions: [".vue"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("vue-language-server")
    const args: string[] = []
    if (!binary) {
      const js = path.join(
        Global.Path.bin,
        "node_modules",
        "@vue",
        "language-server",
        "bin",
        "vue-language-server.js",
      )
      if (!(await Filesystem.exists(js))) {
        if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "@vue/language-server"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        }).exited
      }
      binary = BunProc.which()
      args.push("run", js)
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization: {
        // Leave empty; the server will auto-detect workspace TypeScript.
      },
    }
  },
}

export const ESLint: Info = {
  id: "eslint",
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
  async spawn(root) {
    const eslint = Module.resolve("eslint", Instance.directory)
    if (!eslint) return
    log.info("spawning eslint server")
    const serverPath = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
    const ready = await downloadEslintServer()
    if (!ready) return

    const proc = spawn(BunProc.which(), [serverPath, "--stdio"], {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })

    return {
      process: proc,
    }
  },
}

export const Oxlint: Info = {
  id: "oxlint",
  root: NearestRoot([
    ".oxlintrc.json",
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package.json",
  ]),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".astro", ".svelte"],
  async spawn(root) {
    const resolved = await resolveOxlintLspBin(root)
    if (!resolved) {
      log.info("oxlint not found, please install oxlint")
      return
    }
    const args = resolved.useLsp ? ["--lsp"] : []
    return {
      process: spawn(resolved.bin, args, { cwd: root }),
    }
  },
}

export const Biome: Info = {
  id: "biome",
  root: NearestRoot([
    "biome.json",
    "biome.jsonc",
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
  ]),
  extensions: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".json",
    ".jsonc",
    ".vue",
    ".astro",
    ".svelte",
    ".css",
    ".graphql",
    ".gql",
    ".html",
  ],
  async spawn(root) {
    const localBin = path.join(root, "node_modules", ".bin", "biome")
    let bin: string | undefined
    if (await Filesystem.exists(localBin)) bin = localBin
    if (!bin) {
      const found = which("biome")
      if (found) bin = found
    }

    let args = ["lsp-proxy", "--stdio"]

    if (!bin) {
      const resolved = Module.resolve("biome", root)
      if (!resolved) return
      bin = BunProc.which()
      args = ["x", "biome", "lsp-proxy", "--stdio"]
    }

    const proc = spawn(bin, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })

    return {
      process: proc,
    }
  },
}

export const Svelte: Info = {
  id: "svelte",
  extensions: [".svelte"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("svelteserver")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "svelte-language-server", "bin", "server.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "svelte-language-server"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        }).exited
      }
      binary = BunProc.which()
      args.push("run", js)
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization: {},
    }
  },
}

export const Astro: Info = {
  id: "astro",
  extensions: [".astro"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    const tsserver = Module.resolve("typescript/lib/tsserver.js", Instance.directory)
    if (!tsserver) {
      log.info("typescript not found, required for Astro language server")
      return
    }
    const tsdk = path.dirname(tsserver)

    let binary = which("astro-ls")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "@astrojs", "language-server", "bin", "nodeServer.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "@astrojs/language-server"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        }).exited
      }
      binary = BunProc.which()
      args.push("run", js)
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization: {
        typescript: {
          tsdk,
        },
      },
    }
  },
}
