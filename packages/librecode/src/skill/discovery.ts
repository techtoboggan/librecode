import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"

const discoveryLog = Log.create({ service: "skill-discovery" })

type Index = {
  skills: Array<{
    name: string
    description: string
    files: string[]
  }>
}

function discoveryDir() {
  return path.join(Global.Path.cache, "skills")
}

async function discoveryFetch(url: string, dest: string): Promise<boolean> {
  if (await Filesystem.exists(dest)) return true
  return fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        discoveryLog.error("failed to download", { url, status: response.status })
        return false
      }
      if (response.body) await Filesystem.writeStream(dest, response.body)
      return true
    })
    .catch((err) => {
      discoveryLog.error("failed to download", { url, err })
      return false
    })
}

async function discoveryPull(url: string): Promise<string[]> {
  const result: string[] = []
  const base = url.endsWith("/") ? url : `${url}/`
  const index = new URL("index.json", base).href
  const cache = discoveryDir()
  const host = base.slice(0, -1)

  discoveryLog.info("fetching index", { url: index })
  const data = await fetch(index)
    .then(async (response) => {
      if (!response.ok) {
        discoveryLog.error("failed to fetch index", { url: index, status: response.status })
        return undefined
      }
      return response
        .json()
        .then((json) => json as Index)
        .catch((err) => {
          discoveryLog.error("failed to parse index", { url: index, err })
          return undefined
        })
    })
    .catch((err) => {
      discoveryLog.error("failed to fetch index", { url: index, err })
      return undefined
    })

  if (!data?.skills || !Array.isArray(data.skills)) {
    discoveryLog.warn("invalid index format", { url: index })
    return result
  }

  const list = data.skills.filter((skill) => {
    if (!skill?.name || !Array.isArray(skill.files)) {
      discoveryLog.warn("invalid skill entry", { url: index, skill })
      return false
    }
    return true
  })

  await Promise.all(
    list.map(async (skill) => {
      const root = path.join(cache, skill.name)
      await Promise.all(
        skill.files.map(async (file) => {
          const link = new URL(file, `${host}/${skill.name}/`).href
          const dest = path.join(root, file)
          await mkdir(path.dirname(dest), { recursive: true })
          await discoveryFetch(link, dest)
        }),
      )

      const md = path.join(root, "SKILL.md")
      if (await Filesystem.exists(md)) result.push(root)
    }),
  )

  return result
}

export const Discovery = {
  dir: discoveryDir,
  pull: discoveryPull,
} as const
