import { Log } from "@/util/log"
import { Bus } from "../bus"
import { Command } from "../command"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Format } from "../format"
import { LSP } from "../lsp"
import { Plugin } from "../plugin"
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"
import { Instance } from "./instance"
import { Project } from "./project"
import { Vcs } from "./vcs"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  Format.init()
  await LSP.init()
  FileWatcher.init()
  File.init()
  Vcs.init()
  Snapshot.init()
  Truncate.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
