import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Log } from "../../util/log"

const log = Log.create({ service: "system" })

const SystemInfoSchema = z.object({
  os: z.string(),
  arch: z.string(),
  gpuVendor: z.string().optional(),
  gpuModel: z.string().optional(),
  cudaVersion: z.string().optional(),
  rocmVersion: z.string().optional(),
  metalSupported: z.boolean().optional(),
})

export type SystemInfo = z.infer<typeof SystemInfoSchema>

async function runCommand(cmd: string, args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    return text.trim()
  } catch {
    return ""
  }
}

async function detectGpu(): Promise<
  Pick<SystemInfo, "gpuVendor" | "gpuModel" | "cudaVersion" | "rocmVersion" | "metalSupported">
> {
  const os = process.platform

  if (os === "darwin") {
    const spOutput = await runCommand("system_profiler", ["SPDisplaysDataType"])
    const chipMatch = spOutput.match(/Chip(?:set)? Model:\s*(.+)/i)
    const vendorMatch = spOutput.match(/Vendor:\s*(.+)/i)
    return {
      gpuVendor: vendorMatch?.[1]?.trim() ?? "Apple",
      gpuModel: chipMatch?.[1]?.trim() ?? "Apple Silicon",
      metalSupported: true,
    }
  }

  if (os === "linux") {
    // Try nvidia-smi first
    const nvidiaSmi = await runCommand("nvidia-smi", [
      "--query-gpu=name,driver_version",
      "--format=csv,noheader,nounits",
    ])
    if (nvidiaSmi) {
      const [model, driverVersion] = nvidiaSmi.split(",").map((s) => s.trim())
      const cudaOut = await runCommand("nvidia-smi", ["--query-gpu=compute_cap", "--format=csv,noheader"])
      return {
        gpuVendor: "NVIDIA",
        gpuModel: model,
        cudaVersion: driverVersion ? `Driver ${driverVersion}` : undefined,
      }
    }

    // Try ROCm
    const rocmSmi = await runCommand("rocm-smi", ["--showproductname"])
    if (rocmSmi && !rocmSmi.includes("command not found")) {
      const modelMatch = rocmSmi.match(/Card Series:\s*(.+)/i) ?? rocmSmi.match(/GPU\[0\]\s*:\s*(.+)/i)
      const rocmVer = await runCommand("rocm-smi", ["--showdriverversion"])
      const verMatch = rocmVer.match(/Driver version:\s*(.+)/i)
      return {
        gpuVendor: "AMD",
        gpuModel: modelMatch?.[1]?.trim() ?? "AMD GPU",
        rocmVersion: verMatch?.[1]?.trim(),
      }
    }

    // Fallback to lspci
    const lspci = await runCommand("lspci", [])
    const vgaLine = lspci.split("\n").find((l) => /VGA|3D|Display/i.test(l))
    if (vgaLine) {
      const isNvidia = /nvidia/i.test(vgaLine)
      const isAmd = /amd|radeon/i.test(vgaLine)
      const isIntel = /intel/i.test(vgaLine)
      const vendor = isNvidia ? "NVIDIA" : isAmd ? "AMD" : isIntel ? "Intel" : "Unknown"
      const model = vgaLine.replace(/^.*:\s*/, "").trim()
      return { gpuVendor: vendor, gpuModel: model }
    }

    return {}
  }

  if (os === "win32") {
    const wmicOut = await runCommand("wmic", ["path", "win32_VideoController", "get", "name"])
    const lines = wmicOut.split("\n").filter((l) => l.trim() && !l.startsWith("Name"))
    const model = lines[0]?.trim()
    if (model) {
      const isNvidia = /nvidia/i.test(model)
      const isAmd = /amd|radeon/i.test(model)
      return {
        gpuVendor: isNvidia ? "NVIDIA" : isAmd ? "AMD" : "Intel",
        gpuModel: model,
      }
    }
    return {}
  }

  return {}
}

export function SystemRoutes() {
  return new Hono().get(
    "/info",
    describeRoute({
      summary: "System information",
      description: "Detect OS, architecture, and GPU for local compute setup recommendations.",
      operationId: "system.info",
      responses: {
        200: {
          description: "System information",
          content: { "application/json": { schema: resolver(SystemInfoSchema) } },
        },
      },
    }),
    async (c) => {
      log.info("detecting system info")
      const gpu = await detectGpu()
      const info: SystemInfo = {
        os: process.platform,
        arch: process.arch,
        ...gpu,
      }
      return c.json(info)
    },
  )
}
