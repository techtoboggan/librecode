/**
 * Platform mock utilities for LibreCode unit tests.
 *
 * LibreCode abstracts all Tauri IPC calls behind a Platform context
 * (packages/app/src/context/platform.tsx) rather than calling
 * @tauri-apps/api directly. Tests mock the Platform object accordingly.
 *
 * Note on @tauri-apps/api/mocks: this was a Tauri v1 feature that does not
 * exist in Tauri v2 (which this project uses). The correct approach for v2
 * is to mock window.__TAURI_INTERNALS__ directly for raw invoke() calls,
 * but since every component in this project goes through Platform context,
 * mocking the Platform object is simpler, more accurate, and portable
 * across web/desktop builds.
 *
 * Usage:
 *
 *   import { createMockPlatform } from "@/test-utils/tauri-mock"
 *   import { mock } from "bun:test"
 *
 *   const calls: string[] = []
 *   mock.module("@/context/platform", () => ({
 *     usePlatform: () => createMockPlatform({
 *       openDetachedWindow: async (opts) => {
 *         calls.push(opts.uri)
 *       },
 *     }),
 *   }))
 *
 * See Phase 52 Sub-B for detailed adoption examples.
 */

import type { Platform } from "@/context/platform"

/**
 * Returns a Platform mock with safe no-op defaults for every method.
 *
 * Pass `overrides` to spy on specific calls or return custom values.
 * The returned object satisfies the full Platform type — callers can
 * destructure or spread it without TypeScript errors.
 */
export function createMockPlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    platform: "desktop",
    os: "linux",
    version: "0.0.0-test",
    openLink: () => {},
    restart: async () => {},
    back: () => {},
    forward: () => {},
    notify: async () => {},
    // Optional Tauri-only methods — Phase 49
    openDetachedWindow: async () => {},
    closeDetachedWindow: async () => {},
    focusDetachedWindow: async () => {},
    invokeTauriEvent: async () => {},
    listenTauriEvent: async () => () => {},
    // Optional platform utilities
    openPath: async () => {},
    openDirectoryPickerDialog: async () => null,
    openFilePickerDialog: async () => null,
    saveFilePickerDialog: async () => null,
    checkUpdate: async () => ({ updateAvailable: false }),
    update: async () => {},
    getDefaultServer: async () => null,
    setDefaultServer: async () => {},
    getWslEnabled: async () => false,
    setWslEnabled: async () => {},
    getDisplayBackend: async () => "auto" as const,
    setDisplayBackend: async () => {},
    parseMarkdown: async (md) => md,
    checkAppExists: async () => false,
    readClipboardImage: async () => null,
    ...overrides,
  }
}

/**
 * Returns a bun mock.module()-compatible factory for "@/context/platform".
 *
 * Usage:
 *   mock.module("@/context/platform", makePlatformModule())
 *   mock.module("@/context/platform", makePlatformModule({ platform: "web" }))
 */
export function makePlatformModule(overrides: Partial<Platform> = {}): () => { usePlatform: () => Platform } {
  return () => ({ usePlatform: () => createMockPlatform(overrides) })
}
