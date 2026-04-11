import path from "path"
import { spawn as launch } from "child_process"
import { Global, Filesystem, Instance, Flag, Process, which, log, installElixirLS, downloadZls, findClangdBin, downloadClangd } from "../install"
import { type Handle, type Info, NearestRoot } from "./web"

const spawn = ((cmd, args, opts) => {
  if (Array.isArray(args)) return launch(cmd, [...args], { ...(opts ?? {}), windowsHide: true })
  return launch(cmd, { ...(args ?? {}), windowsHide: true })
}) as typeof launch

export const Gopls: Info = {
  id: "gopls",
  root: async (file) => {
    const work = await NearestRoot(["go.work"])(file)
    if (work) return work
    return NearestRoot(["go.mod", "go.sum"])(file)
  },
  extensions: [".go"],
  async spawn(root) {
    let bin = which("gopls", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })
    if (!bin) {
      if (!which("go")) return
      if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return

      log.info("installing gopls")
      const proc = Process.spawn(["go", "install", "golang.org/x/tools/gopls@latest"], {
        env: { ...process.env, GOBIN: Global.Path.bin },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install gopls")
        return
      }
      bin = path.join(Global.Path.bin, "gopls" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed gopls`, {
        bin,
      })
    }
    return {
      process: spawn(bin!, {
        cwd: root,
      }),
    }
  },
}

export const Rubocop: Info = {
  id: "ruby-lsp",
  root: NearestRoot(["Gemfile"]),
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async spawn(root) {
    let bin = which("rubocop", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })
    if (!bin) {
      const ruby = which("ruby")
      const gem = which("gem")
      if (!ruby || !gem) {
        log.info("Ruby not found, please install Ruby first")
        return
      }
      if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return
      log.info("installing rubocop")
      const proc = Process.spawn(["gem", "install", "rubocop", "--bindir", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install rubocop")
        return
      }
      bin = path.join(Global.Path.bin, "rubocop" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed rubocop`, {
        bin,
      })
    }
    return {
      process: spawn(bin!, ["--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const ElixirLS: Info = {
  id: "elixir-ls",
  extensions: [".ex", ".exs"],
  root: NearestRoot(["mix.exs", "mix.lock"]),
  async spawn(root) {
    const binary = which("elixir-ls") ?? (await installElixirLS())
    if (!binary) return

    return {
      process: spawn(binary, { cwd: root }),
    }
  },
}

export const Zls: Info = {
  id: "zls",
  extensions: [".zig", ".zon"],
  root: NearestRoot(["build.zig"]),
  async spawn(root) {
    const bin =
      which("zls", { PATH: process.env["PATH"] + path.delimiter + Global.Path.bin }) ?? (await downloadZls())
    if (!bin) return

    return {
      process: spawn(bin, { cwd: root }),
    }
  },
}

export const CSharp: Info = {
  id: "csharp",
  root: NearestRoot([".slnx", ".sln", ".csproj", "global.json"]),
  extensions: [".cs"],
  async spawn(root) {
    let bin = which("csharp-ls", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })
    if (!bin) {
      if (!which("dotnet")) {
        log.error(".NET SDK is required to install csharp-ls")
        return
      }

      if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return
      log.info("installing csharp-ls via dotnet tool")
      const proc = Process.spawn(["dotnet", "tool", "install", "csharp-ls", "--tool-path", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install csharp-ls")
        return
      }

      bin = path.join(Global.Path.bin, "csharp-ls" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed csharp-ls`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const FSharp: Info = {
  id: "fsharp",
  root: NearestRoot([".slnx", ".sln", ".fsproj", "global.json"]),
  extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
  async spawn(root) {
    let bin = which("fsautocomplete", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })
    if (!bin) {
      if (!which("dotnet")) {
        log.error(".NET SDK is required to install fsautocomplete")
        return
      }

      if (Flag.LIBRECODE_DISABLE_LSP_DOWNLOAD) return
      log.info("installing fsautocomplete via dotnet tool")
      const proc = Process.spawn(["dotnet", "tool", "install", "fsautocomplete", "--tool-path", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install fsautocomplete")
        return
      }

      bin = path.join(Global.Path.bin, "fsautocomplete" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed fsautocomplete`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const SourceKit: Info = {
  id: "sourcekit-lsp",
  extensions: [".swift", ".objc", "objcpp"],
  root: NearestRoot(["Package.swift", "*.xcodeproj", "*.xcworkspace"]),
  async spawn(root) {
    // Check if sourcekit-lsp is available in the PATH
    // This is installed with the Swift toolchain
    const sourcekit = which("sourcekit-lsp")
    if (sourcekit) {
      return {
        process: spawn(sourcekit, {
          cwd: root,
        }),
      }
    }

    // If sourcekit-lsp not found, check if xcrun is available
    // This is specific to macOS where sourcekit-lsp is typically installed with Xcode
    if (!which("xcrun")) return

    const output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })
    const lspLoc = await output(["xcrun", "--find", "sourcekit-lsp"])

    if (lspLoc.code !== 0) return

    const bin = lspLoc.text.trim()

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const RustAnalyzer: Info = {
  id: "rust",
  root: async (root) => {
    const crateRoot = await NearestRoot(["Cargo.toml", "Cargo.lock"])(root)
    if (crateRoot === undefined) {
      return undefined
    }
    let currentDir = crateRoot

    while (currentDir !== path.dirname(currentDir)) {
      // Stop at filesystem root
      const cargoTomlPath = path.join(currentDir, "Cargo.toml")
      try {
        const cargoTomlContent = await Filesystem.readText(cargoTomlPath)
        if (cargoTomlContent.includes("[workspace]")) {
          return currentDir
        }
      } catch (err) {
        // File doesn't exist or can't be read, continue searching up
      }

      const parentDir = path.dirname(currentDir)
      if (parentDir === currentDir) break // Reached filesystem root
      currentDir = parentDir

      // Stop if we've gone above the app root
      if (!currentDir.startsWith(Instance.worktree)) break
    }

    return crateRoot
  },
  extensions: [".rs"],
  async spawn(root) {
    const bin = which("rust-analyzer")
    if (!bin) {
      log.info("rust-analyzer not found in path, please install it")
      return
    }
    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const Clangd: Info = {
  id: "clangd",
  root: NearestRoot(["compile_commands.json", "compile_flags.txt", ".clangd", "CMakeLists.txt", "Makefile"]),
  extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
  async spawn(root) {
    const args = ["--background-index", "--clang-tidy"]
    const bin = (await findClangdBin()) ?? (await downloadClangd())
    if (!bin) return

    return {
      process: spawn(bin, args, { cwd: root }),
    }
  },
}
