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
  const desktopDir = path.default.join(home, ".local/share/applications")
  // Wayland uses the Cargo package name as app_id, not the Tauri identifier
  const appId = "librecode-desktop"

  // Install icons at multiple sizes so the DE can pick the right one
  for (const [size, file] of [
    ["32x32", "32x32.png"],
    ["64x64", "64x64.png"],
    ["128x128", "128x128.png"],
    ["256x256", "128x128@2x.png"],
    ["512x512", "icon.png"],
  ] as const) {
    const dir = path.default.join(home, `.local/share/icons/hicolor/${size}/apps`)
    await fs.default.mkdir(dir, { recursive: true })
    const src = path.default.resolve(`src-tauri/icons/dev/${file}`)
    await fs.default.copyFile(src, path.default.join(dir, `${appId}.png`)).catch(() => {})
  }

  // Update the URL-handler desktop file with icon
  const handlerDesktopFile = path.default.join(desktopDir, "librecode-desktop-handler.desktop")
  try {
    let content = await fs.default.readFile(handlerDesktopFile, "utf-8")
    if (!content.includes("Icon=")) {
      content = content.replace("[Desktop Entry]", `[Desktop Entry]\nIcon=${appId}`)
      await fs.default.writeFile(handlerDesktopFile, content)
    }
  } catch {
    // Desktop file may not exist yet on first run
  }

  // Create a visible desktop file matching the Wayland app_id so compositors
  // can find our icon. Wayland compositors look up the app_id (which equals the
  // Cargo package name "librecode-desktop") against .desktop file basenames.
  const appDesktopFile = path.default.join(desktopDir, `${appId}.desktop`)
  const binaryPath = path.default.resolve("src-tauri/target/debug/librecode-desktop")
  const appDesktopContent = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=LibreCode Dev",
    `Icon=${appId}`,
    `Exec=${binaryPath} %u`,
    "Terminal=false",
    "Categories=Development;",
    `StartupWMClass=${appId}`,
    "",
  ].join("\n")
  await fs.default.mkdir(desktopDir, { recursive: true })
  await fs.default.writeFile(appDesktopFile, appDesktopContent)

  // Update icon cache
  await $`gtk-update-icon-cache -f -t ${path.default.join(home, ".local/share/icons/hicolor")}`.quiet().nothrow()
  // Update desktop database so compositors pick up the new file
  await $`update-desktop-database ${desktopDir}`.quiet().nothrow()
}
