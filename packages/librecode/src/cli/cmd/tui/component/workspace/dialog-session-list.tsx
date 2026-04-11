import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount, Show } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { DialogSessionRename } from "../dialog-session-rename"
import { useKV } from "../../context/kv"
import { createDebouncedSignal } from "../../util/signal"
import { Spinner } from "../spinner"
import { useToast } from "../../ui/toast"
import type { Session } from "@librecode/sdk/v2"

function sessionCategory(updatedAt: number): string {
  const today = new Date().toDateString()
  const date = new Date(updatedAt)
  const label = date.toDateString()
  return label === today ? "Today" : label
}

function matchesFilter(
  session: Session,
  props: { workspaceID?: string; localOnly?: boolean },
  listed: Session[] | undefined,
): boolean {
  if (session.parentID !== undefined) return false
  if (props.workspaceID && listed) return true
  if (props.workspaceID) return session.workspaceID === props.workspaceID
  if (props.localOnly) return !session.workspaceID
  return true
}

export function DialogSessionList(props: { workspaceID?: string; localOnly?: boolean } = {}) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const kv = useKV()
  const toast = useToast()
  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [listed, listedActions] = createResource(
    () => props.workspaceID,
    async (workspaceID) => {
      if (!workspaceID) return undefined
      const result = await sdk.client.session.list({ roots: true })
      return result.data ?? []
    },
  )

  const [searchResults] = createResource(search, async (query) => {
    if (!query || props.localOnly) return undefined
    const result = await sdk.client.session.list({
      search: query,
      limit: 30,
      ...(props.workspaceID ? { roots: true } : {}),
    })
    return result.data ?? []
  })

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo(() => {
    if (searchResults()) return searchResults()!
    if (props.workspaceID) return listed() ?? []
    if (props.localOnly) return sync.data.session.filter((session) => !session.workspaceID)
    return sync.data.session
  })

  const options = createMemo(() =>
    sessions()
      .filter((x) => matchesFilter(x, props, listed()))
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => {
        const isDeleting = toDelete() === x.id
        const status = sync.data.session_status?.[x.id]
        return {
          title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category: sessionCategory(x.time.updated),
          footer: Locale.time(x.time.updated),
          gutter: status?.type === "busy" ? <Spinner /> : undefined,
        }
      }),
  )

  onMount(() => {
    dialog.setSize("large")
  })

  async function handleSessionDelete(sessionID: string): Promise<void> {
    if (toDelete() !== sessionID) {
      setToDelete(sessionID)
      return
    }
    const deleted = await sdk.client.session.delete({ sessionID }).then(() => true).catch(() => false)
    setToDelete(undefined)
    if (!deleted) {
      toast.show({ message: "Failed to delete session", variant: "error" })
      return
    }
    if (props.workspaceID) {
      listedActions.mutate((sessions) => sessions?.filter((session) => session.id !== sessionID))
      return
    }
    sync.set("session", sync.data.session.filter((session) => session.id !== sessionID))
  }

  return (
    <DialogSelect
      title={props.workspaceID ? `Workspace Sessions` : props.localOnly ? "Local Sessions" : "Sessions"}
      options={options()}
      skipFilter={!props.localOnly}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: (option) => handleSessionDelete(option.value),
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
      ]}
    />
  )
}
