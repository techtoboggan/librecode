import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { xdgCache, xdgConfig, xdgData, xdgState } from "xdg-basedir"
import { Filesystem } from "../util/filesystem"

const app = "librecode"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

const GlobalPath = {
  // Allow override via LIBRECODE_TEST_HOME for test isolation
  get home() {
    return process.env.LIBRECODE_TEST_HOME || os.homedir()
  },
  data,
  bin: path.join(data, "bin"),
  log: path.join(data, "log"),
  cache,
  config,
  state,
}

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Global {
  // (no types to export — all runtime values)
}

export const Global = {
  Path: GlobalPath,
} as const

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Global.Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (_e) {}
  await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
