import { untrack } from "solid-js"
import { produce, type SetStoreFunction } from "solid-js/store"
import { base64Encode } from "@librecode/util/encode"
import { getFilename } from "@librecode/util/path"
import { showToast, toaster } from "@librecode/ui/toast"
import { type Session } from "@librecode/sdk/v2/client"
import { Binary } from "@librecode/util/binary"
import { clearWorkspaceTerminals } from "@/context/terminal"
import { displayName, effectiveWorkspaceOrder, errorMessage, latestRootSession, workspaceKey } from "./helpers"
import type { LocalProject } from "@/context/layout"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { useLayout } from "@/context/layout"
import type { usePlatform } from "@/context/platform"
import type { useServer } from "@/context/server"
import type { useLanguage } from "@/context/language"
import type { useNotification } from "@/context/notification"

type GlobalSDK = ReturnType<typeof useGlobalSDK>
type GlobalSync = ReturnType<typeof useGlobalSync>
type Layout = ReturnType<typeof useLayout>
type Platform = ReturnType<typeof usePlatform>
type Server = ReturnType<typeof useServer>
type Language = ReturnType<typeof useLanguage>
type Notification = ReturnType<typeof useNotification>

export type LayoutStore = {
  lastProjectSession: { [directory: string]: { directory: string; id: string; at: number } }
  activeProject: string | undefined
  activeWorkspace: string | undefined
  workspaceOrder: Record<string, string[]>
  workspaceName: Record<string, string>
  workspaceBranchName: Record<string, Record<string, string>>
  workspaceExpanded: Record<string, boolean>
  gettingStartedDismissed: boolean
}

export type ProjectActionsDeps = {
  params: { dir?: string; id?: string }
  store: LayoutStore
  setStore: SetStoreFunction<LayoutStore>
  globalSDK: GlobalSDK
  globalSync: GlobalSync
  layout: Layout
  platform: Platform
  server: Server
  language: Language
  notification: Notification
  navigate: (href: string) => void
  navigateWithSidebarReset: (href: string) => void
  currentDir: () => string
  currentProject: () => LocalProject | undefined
  scrollToSession: (id: string, key: string) => void
  setBusy: (directory: string, value: boolean) => void
}

export type ProjectActions = {
  projectRoot: (directory: string) => string
  activeProjectRoot: (directory: string) => string
  touchProjectRoute: () => string | undefined
  rememberSessionRoute: (directory: string, id: string, root?: string) => string
  clearLastProjectSession: (root: string) => void
  syncSessionRoute: (directory: string, id: string, root?: string) => string
  navigateToProject: (directory: string | undefined) => Promise<void>
  navigateToSession: (session: Session | undefined) => void
  openProject: (directory: string, nav?: boolean) => void
  renameProject: (project: LocalProject, next: string) => Promise<void>
  renameWorkspace: (directory: string, next: string, projectId?: string, branch?: string) => void
  closeProject: (directory: string) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  deleteWorkspace: (root: string, directory: string, leaveDeletedWorkspace?: boolean) => Promise<void>
  resetWorkspace: (root: string, directory: string) => Promise<void>
  archiveSession: (session: Session) => Promise<void>
  workspaceName: (directory: string, projectId?: string, branch?: string) => string | undefined
  setWorkspaceName: (directory: string, next: string, projectId?: string, branch?: string) => void
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
}

export function createProjectActions(deps: ProjectActionsDeps): ProjectActions {
  const {
    params,
    store,
    setStore,
    globalSDK,
    globalSync,
    layout,
    platform,
    server,
    language,
    notification,
    navigate,
    navigateWithSidebarReset,
    currentDir,
    currentProject,
    scrollToSession,
    setBusy,
  } = deps

  const workspaceName = (directory: string, projectId?: string, branch?: string): string | undefined => {
    const key = workspaceKey(directory)
    const direct = store.workspaceName[key] ?? store.workspaceName[directory]
    if (direct) return direct
    if (!projectId) return
    if (!branch) return
    return store.workspaceBranchName[projectId]?.[branch]
  }

  const setWorkspaceName = (directory: string, next: string, projectId?: string, branch?: string): void => {
    const key = workspaceKey(directory)
    setStore("workspaceName", key, next)
    if (!projectId) return
    if (!branch) return
    if (!store.workspaceBranchName[projectId]) {
      setStore("workspaceBranchName", projectId, {})
    }
    setStore("workspaceBranchName", projectId, branch, next)
  }

  const workspaceLabel = (directory: string, branch?: string, projectId?: string): string =>
    workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)

  function projectRoot(directory: string): string {
    const project = layout.projects
      .list()
      .find((item) => item.worktree === directory || item.sandboxes?.includes(directory))
    if (project) return project.worktree

    const known = Object.entries(store.workspaceOrder).find(
      ([root, dirs]) => root === directory || dirs.includes(directory),
    )
    if (known) return known[0]

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return directory

    const meta = globalSync.data.project.find((item) => item.id === id)
    return meta?.worktree ?? directory
  }

  function activeProjectRoot(directory: string): string {
    return currentProject()?.worktree ?? projectRoot(directory)
  }

  function touchProjectRoute(): string | undefined {
    const root = currentProject()?.worktree
    if (!root) return
    if (server.projects.last() !== root) server.projects.touch(root)
    return root
  }

  function rememberSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)): string {
    setStore("lastProjectSession", root, { directory, id, at: Date.now() })
    return root
  }

  function clearLastProjectSession(root: string): void {
    if (!store.lastProjectSession[root]) return
    setStore(
      "lastProjectSession",
      produce((draft) => {
        delete draft[root]
      }),
    )
  }

  function syncSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)): string {
    rememberSessionRoute(directory, id, root)
    notification.session.markViewed(id)
    const expanded = untrack(() => store.workspaceExpanded[directory])
    if (expanded === false) {
      setStore("workspaceExpanded", directory, true)
    }
    requestAnimationFrame(() => scrollToSession(id, `${directory}:${id}`))
    return root
  }

  async function navigateToProject(directory: string | undefined): Promise<void> {
    if (!directory) return
    const root = projectRoot(directory)
    server.projects.touch(root)
    const project = layout.projects.list().find((item) => item.worktree === root)
    let dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const canOpen = (value: string | undefined) => {
      if (!value) return false
      return dirs.some((item) => workspaceKey(item) === workspaceKey(value))
    }
    const refreshDirs = async (target?: string) => {
      if (!target || target === root || canOpen(target)) return canOpen(target)
      const listed = await globalSDK.client.worktree
        .list({ directory: root })
        .then((x) => x.data ?? [])
        .catch(() => [] as string[])
      dirs = effectiveWorkspaceOrder(root, [root, ...listed], store.workspaceOrder[root])
      return canOpen(target)
    }
    const openSession = async (target: { directory: string; id: string }) => {
      if (!canOpen(target.directory)) return false
      const [data] = globalSync.child(target.directory, { bootstrap: false })
      if (data.session.some((item) => item.id === target.id)) {
        setStore("lastProjectSession", root, { directory: target.directory, id: target.id, at: Date.now() })
        navigateWithSidebarReset(`/${base64Encode(target.directory)}/session/${target.id}`)
        return true
      }
      const resolved = await globalSDK.client.session
        .get({ sessionID: target.id })
        .then((x) => x.data)
        .catch(() => undefined)
      if (!resolved?.directory) return false
      if (!canOpen(resolved.directory)) return false
      setStore("lastProjectSession", root, { directory: resolved.directory, id: resolved.id, at: Date.now() })
      navigateWithSidebarReset(`/${base64Encode(resolved.directory)}/session/${resolved.id}`)
      return true
    }

    const projectSession = store.lastProjectSession[root]
    if (projectSession?.id) {
      await refreshDirs(projectSession.directory)
      const opened = await openSession(projectSession)
      if (opened) return
      clearLastProjectSession(root)
    }

    const latest = latestRootSession(
      dirs.map((item) => globalSync.child(item, { bootstrap: false })[0]),
      Date.now(),
    )
    if (latest && (await openSession(latest))) return

    const fetched = latestRootSession(
      await Promise.all(
        dirs.map(async (item) => ({
          path: { directory: item },
          session: await globalSDK.client.session
            .list({ directory: item })
            .then((x) => x.data ?? [])
            .catch(() => []),
        })),
      ),
      Date.now(),
    )
    if (fetched && (await openSession(fetched))) return

    navigateWithSidebarReset(`/${base64Encode(root)}/session`)
  }

  function navigateToSession(session: Session | undefined): void {
    if (!session) return
    navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  function openProject(directory: string, nav = true): void {
    layout.projects.open(directory)
    if (nav) navigateToProject(directory)
  }

  async function renameProject(project: LocalProject, next: string): Promise<void> {
    const current = displayName(project)
    if (next === current) return
    const name = next === getFilename(project.worktree) ? "" : next

    if (project.id && project.id !== "global") {
      await globalSDK.client.project.update({ projectID: project.id, directory: project.worktree, name })
      return
    }

    globalSync.project.meta(project.worktree, { name })
  }

  const renameWorkspace = (directory: string, next: string, projectId?: string, branch?: string): void => {
    const current = workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)
    if (current === next) return
    setWorkspaceName(directory, next, projectId, branch)
  }

  function closeProject(directory: string): void {
    const list = layout.projects.list()
    const index = list.findIndex((x) => x.worktree === directory)
    const active = currentProject()?.worktree === directory
    if (index === -1) return
    const next = list[index + 1]

    if (!active) {
      layout.projects.close(directory)
      return
    }

    if (!next) {
      layout.projects.close(directory)
      navigate("/")
      return
    }

    navigateWithSidebarReset(`/${base64Encode(next.worktree)}/session`)
    layout.projects.close(directory)
    queueMicrotask(() => {
      void navigateToProject(next.worktree)
    })
  }

  function toggleProjectWorkspaces(project: LocalProject): void {
    const enabled = layout.sidebar.workspaces(project.worktree)()
    if (enabled) {
      layout.sidebar.toggleWorkspaces(project.worktree)
      return
    }
    if (project.vcs !== "git") return
    layout.sidebar.toggleWorkspaces(project.worktree)
  }

  const deleteWorkspace = async (root: string, directory: string, leaveDeletedWorkspace = false): Promise<void> => {
    if (directory === root) return

    const current = currentDir()
    const currentKey = workspaceKey(current)
    const deletedKey = workspaceKey(directory)
    const shouldLeave = leaveDeletedWorkspace || (!!params.dir && currentKey === deletedKey)
    if (!leaveDeletedWorkspace && shouldLeave) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }

    setBusy(directory, true)

    const result = await globalSDK.client.worktree
      .remove({ directory: root, worktreeRemoveInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    setBusy(directory, false)
    if (!result) return

    if (workspaceKey(store.lastProjectSession[root]?.directory ?? "") === workspaceKey(directory)) {
      clearLastProjectSession(root)
    }

    globalSync.set(
      "project",
      produce((draft) => {
        const project = draft.find((item) => item.worktree === root)
        if (!project) return
        project.sandboxes = (project.sandboxes ?? []).filter((sandbox) => sandbox !== directory)
      }),
    )
    setStore("workspaceOrder", root, (order) => (order ?? []).filter((workspace: string) => workspace !== directory))

    layout.projects.close(directory)
    layout.projects.open(root)

    if (shouldLeave) return

    const nextCurrent = currentDir()
    const nextKey = workspaceKey(nextCurrent)
    const project = layout.projects.list().find((item) => item.worktree === root)
    const dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const valid = dirs.some((item) => workspaceKey(item) === nextKey)

    if (params.dir && projectRoot(nextCurrent) === root && !valid) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }
  }

  const resetWorkspace = async (root: string, directory: string): Promise<void> => {
    if (directory === root) return
    setBusy(directory, true)

    const progress = showToast({
      persistent: true,
      title: language.t("workspace.resetting.title"),
      description: language.t("workspace.resetting.description"),
    })
    const dismiss = () => toaster.dismiss(progress)

    const sessions: Session[] = await globalSDK.client.session
      .list({ directory })
      .then((x) => x.data ?? [])
      .catch(() => [])

    clearWorkspaceTerminals(
      directory,
      sessions.map((s) => s.id),
      platform,
    )
    await globalSDK.client.instance.dispose({ directory }).catch(() => undefined)

    const result = await globalSDK.client.worktree
      .reset({ directory: root, worktreeResetInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.reset.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    if (!result) {
      setBusy(directory, false)
      dismiss()
      return
    }

    const archivedAt = Date.now()
    await Promise.all(
      sessions
        .filter((session) => session.time.archived === undefined)
        .map((session) =>
          globalSDK.client.session
            .update({ sessionID: session.id, directory: session.directory, time: { archived: archivedAt } })
            .catch(() => undefined),
        ),
    )

    setBusy(directory, false)
    dismiss()

    showToast({
      title: language.t("workspace.reset.success.title"),
      description: language.t("workspace.reset.success.description"),
      actions: [
        {
          label: language.t("command.session.new"),
          onClick: () => {
            const href = `/${base64Encode(directory)}/session`
            navigate(href)
            layout.mobileSidebar.hide()
          },
        },
        { label: language.t("common.dismiss"), onClick: "dismiss" },
      ],
    })
  }

  async function archiveSession(session: Session): Promise<void> {
    const [dirStore, setDirStore] = globalSync.child(session.directory)
    const sessions = dirStore.session ?? []
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]

    await globalSDK.client.session.update({
      directory: session.directory,
      sessionID: session.id,
      time: { archived: Date.now() },
    })
    setDirStore(
      produce((draft) => {
        const match = Binary.search(draft.session, session.id, (s) => s.id)
        if (match.found) draft.session.splice(match.index, 1)
      }),
    )
    if (session.id === params.id) {
      if (nextSession) {
        navigate(`/${params.dir}/session/${nextSession.id}`)
      } else {
        navigate(`/${params.dir}/session`)
      }
    }
  }

  return {
    projectRoot,
    activeProjectRoot,
    touchProjectRoute,
    rememberSessionRoute,
    clearLastProjectSession,
    syncSessionRoute,
    navigateToProject,
    navigateToSession,
    openProject,
    renameProject,
    renameWorkspace,
    closeProject,
    toggleProjectWorkspaces,
    deleteWorkspace,
    resetWorkspace,
    archiveSession,
    workspaceName,
    setWorkspaceName,
    workspaceLabel,
  }
}
