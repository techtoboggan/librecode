// Tauri Specta bindings — HAND-MAINTAINED, do NOT regenerate blindly.
//
// Background (Phase 49 forensic):
//   The pinned specta/tauri-specta git revs in Cargo.toml have a type-registry
//   bug that conflates distinct `specta::Type`-deriving types — `cargo test`
//   regenerates this file with `setDisplayBackend` taking `InitStep` instead of
//   `LinuxDisplayBackend`, `wslPath`'s `mode` losing its `WslPathMode` shape,
//   etc. Until that bug is fixed upstream (or we change pins), this file is
//   maintained by hand. The auto-regeneration in `lib.rs::test_export_types`
//   is gated behind `LIBRECODE_REGEN_BINDINGS=1` so routine `cargo test` runs
//   don't trash these types.
//
// When adding a new Tauri command:
//   1. Add the function to `make_specta_builder` in `lib.rs`.
//   2. Add the command to the `commands` const below, matching its Rust shape.
//   3. Optionally run `LIBRECODE_REGEN_BINDINGS=1 cargo test test_export_types`
//      against a scratch file to see what specta would emit — then fix any
//      conflated types by hand before merging the diff in.

import { invoke as __TAURI_INVOKE, Channel } from "@tauri-apps/api/core"
import * as __TAURI_EVENT from "@tauri-apps/api/event"

/** Commands */
export const commands = {
  killSidecar: () => __TAURI_INVOKE<void>("kill_sidecar"),
  installCli: () => __TAURI_INVOKE<string>("install_cli"),
  awaitInitialization: (events: Channel) => __TAURI_INVOKE<ServerReadyData>("await_initialization", { events }),
  getDefaultServerUrl: () => __TAURI_INVOKE<string | null>("get_default_server_url"),
  setDefaultServerUrl: (url: string | null) => __TAURI_INVOKE<null>("set_default_server_url", { url }),
  getWslConfig: () => __TAURI_INVOKE<WslConfig>("get_wsl_config"),
  setWslConfig: (config: WslConfig) => __TAURI_INVOKE<null>("set_wsl_config", { config }),
  getDisplayBackend: () => __TAURI_INVOKE<LinuxDisplayBackend | null>("get_display_backend"),
  setDisplayBackend: (backend: LinuxDisplayBackend) => __TAURI_INVOKE<null>("set_display_backend", { backend }),
  parseMarkdownCommand: (markdown: string) => __TAURI_INVOKE<string>("parse_markdown_command", { markdown }),
  checkAppExists: (appName: string) => __TAURI_INVOKE<boolean>("check_app_exists", { appName }),
  wslPath: (path: string, mode: WslPathMode | null) => __TAURI_INVOKE<string>("wsl_path", { path, mode }),
  resolveAppPath: (appName: string) => __TAURI_INVOKE<string | null>("resolve_app_path", { appName }),
  openPath: (path: string, appName: string | null) => __TAURI_INVOKE<null>("open_path", { path, appName }),
  // Phase 49 — detachable app windows
  openDetachedAppWindow: (server: string, uri: string, appName: string, dir: string) =>
    __TAURI_INVOKE<null>("open_detached_app_window", { server, uri, appName, dir }),
  closeDetachedAppWindow: (server: string, uri: string) =>
    __TAURI_INVOKE<null>("close_detached_app_window", { server, uri }),
  isDetachedAppWindowOpen: (server: string, uri: string) =>
    __TAURI_INVOKE<boolean>("is_detached_app_window_open", { server, uri }),
}

/** Events */
export const events = {
  // LoadingWindowComplete is a unit struct in Rust — payload is null
  loadingWindowComplete: makeEvent<null>("loading-window-complete"),
}

/* Types */
export type InitStep = { phase: "server_waiting" } | { phase: "done" }

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

/** WSL path conversion mode — matches Rust `WslPathMode` */
export type WslPathMode = "windows" | "linux"

/** Linux display backend preference — matches Rust `LinuxDisplayBackend` */
export type LinuxDisplayBackend = "wayland" | "auto"

export type WslConfig = {
  enabled: boolean
}

/* Tauri Specta runtime */
function makeEvent<T>(name: string) {
  const base = {
    listen: (cb: __TAURI_EVENT.EventCallback<T>) => __TAURI_EVENT.listen(name, cb),
    once: (cb: __TAURI_EVENT.EventCallback<T>) => __TAURI_EVENT.once(name, cb),
    emit: (payload: T) =>
      __TAURI_EVENT.emit(name, payload) as unknown as T extends null
        ? () => Promise<void>
        : (payload: T) => Promise<void>,
  }

  const fn = (target: import("@tauri-apps/api/webview").Webview | import("@tauri-apps/api/window").Window) => ({
    listen: (cb: __TAURI_EVENT.EventCallback<T>) => target.listen(name, cb),
    once: (cb: __TAURI_EVENT.EventCallback<T>) => target.once(name, cb),
    emit: (payload: T) =>
      target.emit(name, payload) as unknown as T extends null ? () => Promise<void> : (payload: T) => Promise<void>,
  })

  return Object.assign(fn, base)
}
