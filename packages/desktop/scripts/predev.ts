import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../librecode/dist/${sidecarConfig.ocBinary}/bin/librecode`)

// Clean Rust build cache to ensure fresh build with latest icons/resources
await $`cd src-tauri && cargo clean`.quiet().nothrow()

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../librecode && bun run build --single --baseline`
  : $`cd ../librecode && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
