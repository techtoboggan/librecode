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

// Install icon + desktop file for Linux so the DE shows our icon in the taskbar
if (process.platform === "linux") {
  const os = await import("os")
  const path = await import("path")
  const fs = await import("fs/promises")

  const home = os.default.homedir()
  const iconDir = path.default.join(home, ".local/share/icons/hicolor/128x128/apps")
  const desktopDir = path.default.join(home, ".local/share/applications")
  const iconSrc = path.default.resolve("src-tauri/icons/dev/128x128.png")
  const appId = "com.librecode.desktop.dev"

  await fs.default.mkdir(iconDir, { recursive: true })
  await fs.default.copyFile(iconSrc, path.default.join(iconDir, `${appId}.png`))

  // Update the desktop file with icon
  const desktopFile = path.default.join(desktopDir, "librecode-desktop-handler.desktop")
  try {
    let content = await fs.default.readFile(desktopFile, "utf-8")
    if (!content.includes("Icon=")) {
      content = content.replace("[Desktop Entry]", `[Desktop Entry]\nIcon=${appId}`)
      await fs.default.writeFile(desktopFile, content)
    }
  } catch {
    // Desktop file may not exist yet on first run
  }

  // Update icon cache
  await $`gtk-update-icon-cache -f -t ${path.default.join(home, ".local/share/icons/hicolor")}`.quiet().nothrow()
}
