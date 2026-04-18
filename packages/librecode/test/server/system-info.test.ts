import { describe, expect, test } from "bun:test"
import type { SystemInfo } from "../../src/server/routes/system"

describe("SystemInfo type", () => {
  test("has required fields", () => {
    const info: SystemInfo = {
      os: "linux",
      arch: "x64",
    }
    expect(info.os).toBe("linux")
    expect(info.arch).toBe("x64")
    expect(info.gpuVendor).toBeUndefined()
  })

  test("accepts GPU fields", () => {
    const info: SystemInfo = {
      os: "linux",
      arch: "x64",
      gpuVendor: "NVIDIA",
      gpuModel: "RTX 4090",
      cudaVersion: "Driver 550.54",
    }
    expect(info.gpuVendor).toBe("NVIDIA")
    expect(info.gpuModel).toBe("RTX 4090")
    expect(info.cudaVersion).toBe("Driver 550.54")
  })

  test("accepts macOS fields", () => {
    const info: SystemInfo = {
      os: "darwin",
      arch: "arm64",
      gpuVendor: "Apple",
      gpuModel: "Apple M4 Pro",
      metalSupported: true,
    }
    expect(info.metalSupported).toBe(true)
  })

  test("accepts AMD ROCm fields", () => {
    const info: SystemInfo = {
      os: "linux",
      arch: "x64",
      gpuVendor: "AMD",
      gpuModel: "Radeon RX 7900 XTX",
      rocmVersion: "6.0.2",
    }
    expect(info.rocmVersion).toBe("6.0.2")
  })
})
