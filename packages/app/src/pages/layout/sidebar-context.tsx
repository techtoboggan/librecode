import { createMemo, type Accessor } from "solid-js"
import { type SetStoreFunction } from "solid-js/store"
import { type DragEvent } from "@thisbeyond/solid-dnd"
import { useDialog } from "@librecode/ui/context/dialog"
import { type LocalProject } from "@/context/layout"
import { getDraggableId } from "@/utils/solid-dnd"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { effectiveWorkspaceOrder, workspaceKey } from "./helpers"
import { DialogDeleteWorkspace, DialogResetWorkspace, type SidebarPanelCtx } from "./sidebar-panel"
import { type WorkspaceSidebarContext } from "./sidebar-workspace"
import { type ProjectSidebarContext } from "./sidebar-project"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { useLayout } from "@/context/layout"
import type { useLanguage } from "@/context/language"
import type { useNotification } from "@/context/notification"
import type { useProviders } from "@/hooks/use-providers"
import type { createAim } from "@/utils/aim"
import type { Session } from "@librecode/sdk/v2/client"

type GlobalSDK = ReturnType<typeof useGlobalSDK>
type GlobalSync = ReturnType<typeof useGlobalSync>
type Layout = ReturnType<typeof useLayout>
type Language = ReturnType<typeof useLanguage>
type Notification = ReturnType<typeof useNotification>
type Providers = ReturnType<typeof useProviders>
type Aim = ReturnType<typeof createAim>

type InlineEditorComponent = (props: {
  id: string
  value: Accessor<string>
  onSave: (next: string) => void
  class?: string
  displayClass?: string
  editing?: boolean
  stopPropagation?: boolean
  openOnDblClick?: boolean
}) => JSX.Element

import type { JSX } from "solid-js"

type SidebarStore = {
  workspaceOrder: Record<string, string[]>
  workspaceExpanded: Record<string, boolean>
  activeWorkspace: string | undefined
  gettingStartedDismissed: boolean
}

export type SidebarContextDeps = {
  params: { dir?: string; id?: string }
  store: SidebarStore
  setStore: SetStoreFunction<SidebarStore & Record<string, unknown>>
  globalSDK: GlobalSDK
  globalSync: GlobalSync
  layout: Layout
  language: Language
  notification: Notification
  providers: Providers
  aim: Aim
  currentDir: Accessor<string>
  currentProject: Accessor<LocalProject | undefined>
  sidebarHovering: Accessor<boolean>
  sidebarExpanded: Accessor<boolean>
  hoverProjectData: Accessor<LocalProject | undefined>
  state: { hoverSession: string | undefined; hoverProject: string | undefined; nav: HTMLElement | undefined }
  setHoverSession: (id: string | undefined) => void
  clearHoverProjectSoon: () => void
  navigateWithSidebarReset: (href: string) => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  workspaceName: (directory: string, projectId?: string, branch?: string) => string | undefined
  renameWorkspace: (directory: string, next: string, projectId?: string, branch?: string) => void
  renameProject: (project: LocalProject, next: string) => Promise<void>
  closeProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  createWorkspace: (project: LocalProject) => Promise<void>
  connectProvider: () => void
  navigateToProject: (directory: string | undefined) => Promise<void>
  sortNow: () => number
  InlineEditor: InlineEditorComponent
  editorOpen: (id: string) => boolean
  openEditor: (id: string, value: string) => void
  closeEditor: () => void
  setEditor: (key: "value", value: string) => void
  isBusy: (directory: string) => boolean
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  deleteWorkspace: (root: string, directory: string, leave?: boolean) => Promise<void>
  resetWorkspace: (root: string, directory: string) => Promise<void>
  currentSessions: Accessor<Session[]>
  setScrollContainerRef: (el: HTMLDivElement | undefined, mobile?: boolean) => void
}

export type SidebarContexts = {
  workspaceIds: (project: LocalProject | undefined) => string[]
  sidebarProject: Accessor<LocalProject | undefined>
  handleWorkspaceDragStart: (event: unknown) => void
  handleWorkspaceDragOver: (event: DragEvent) => void
  handleWorkspaceDragEnd: () => void
  workspaceSidebarCtx: WorkspaceSidebarContext
  projectSidebarCtx: ProjectSidebarContext
  sidebarPanelCtx: SidebarPanelCtx
}

export function createSidebarContexts(deps: SidebarContextDeps): SidebarContexts {
  const {
    params,
    store,
    setStore,
    globalSDK,
    globalSync,
    layout,
    language,
    notification,
    providers,
    aim,
    currentDir,
    currentProject,
    sidebarHovering,
    sidebarExpanded,
    hoverProjectData,
    state,
    setHoverSession,
    clearHoverProjectSoon,
    navigateWithSidebarReset,
    prefetchSession,
    archiveSession,
    workspaceName,
    renameWorkspace,
    renameProject,
    closeProject,
    showEditProjectDialog,
    toggleProjectWorkspaces,
    createWorkspace,
    connectProvider,
    navigateToProject,
    sortNow,
    InlineEditor,
    editorOpen,
    openEditor,
    closeEditor,
    setEditor,
    isBusy,
    workspaceLabel,
    deleteWorkspace,
    resetWorkspace,
    currentSessions,
    setScrollContainerRef,
  } = deps

  const dialog = useDialog()

  function workspaceIds(project: LocalProject | undefined): string[] {
    if (!project) return []
    const local = project.worktree
    const dirs = [local, ...(project.sandboxes ?? [])]
    const active = currentProject()
    const directory = active?.worktree === project.worktree ? currentDir() : undefined
    const extra = directory && directory !== local && !dirs.includes(directory) ? directory : undefined
    const pending = extra ? WorktreeState.get(extra)?.status === "pending" : false

    const ordered = effectiveWorkspaceOrder(local, dirs, store.workspaceOrder[project.worktree])
    if (pending && extra) return [local, extra, ...ordered.filter((item) => item !== local)]
    if (!extra) return ordered
    if (pending) return ordered
    return [...ordered, extra]
  }

  const sidebarProject = createMemo(() => {
    if (layout.sidebar.opened()) return currentProject()
    const hovered = hoverProjectData()
    if (hovered) return hovered
    return currentProject()
  })

  function handleWorkspaceDragStart(event: unknown): void {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeWorkspace" as never, id as never)
  }

  function handleWorkspaceDragOver(event: DragEvent): void {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const project = sidebarProject()
    if (!project) return

    const ids = workspaceIds(project)
    const fromIndex = ids.findIndex((dir) => dir === draggable.id.toString())
    const toIndex = ids.findIndex((dir) => dir === droppable.id.toString())
    if (fromIndex === -1 || toIndex === -1) return
    if (fromIndex === toIndex) return

    const result = ids.slice()
    const [item] = result.splice(fromIndex, 1)
    if (!item) return
    result.splice(toIndex, 0, item)
    setStore(
      "workspaceOrder" as never,
      project.worktree as never,
      result.filter((directory) => workspaceKey(directory) !== workspaceKey(project.worktree)) as never,
    )
  }

  function handleWorkspaceDragEnd(): void {
    setStore("activeWorkspace" as never, undefined as never)
  }

  const workspaceSidebarCtx: WorkspaceSidebarContext = {
    currentDir,
    navList: currentSessions,
    sidebarExpanded,
    sidebarHovering,
    nav: () => state.nav,
    hoverSession: () => state.hoverSession,
    setHoverSession,
    clearHoverProjectSoon,
    prefetchSession,
    archiveSession,
    workspaceName,
    renameWorkspace,
    editorOpen,
    openEditor,
    closeEditor,
    setEditor,
    InlineEditor,
    isBusy,
    workspaceExpanded: (directory, local) => store.workspaceExpanded[directory] ?? local,
    setWorkspaceExpanded: (directory, value) =>
      setStore("workspaceExpanded" as never, directory as never, value as never),
    showResetWorkspaceDialog: (root, directory) =>
      dialog.show(() => (
        <DialogResetWorkspace root={root} directory={directory} ctx={{ globalSDK, language, resetWorkspace }} />
      )),
    showDeleteWorkspaceDialog: (root, directory) =>
      dialog.show(() => (
        <DialogDeleteWorkspace
          root={root}
          directory={directory}
          ctx={{ globalSDK, language, params, currentDir, navigateWithSidebarReset, deleteWorkspace }}
        />
      )),
    setScrollContainerRef,
  }

  const projectSidebarCtx: ProjectSidebarContext = {
    currentDir,
    sidebarOpened: () => layout.sidebar.opened(),
    sidebarHovering,
    hoverProject: () => state.hoverProject,
    nav: () => state.nav,
    onProjectMouseEnter: (worktree, event) => aim.enter(worktree, event),
    onProjectMouseLeave: (worktree) => aim.leave(worktree),
    onProjectFocus: (worktree) => aim.activate(worktree),
    navigateToProject,
    openSidebar: () => layout.sidebar.open(),
    closeProject,
    showEditProjectDialog,
    toggleProjectWorkspaces,
    workspacesEnabled: (project) => project.vcs === "git" && layout.sidebar.workspaces(project.worktree)(),
    workspaceIds,
    workspaceLabel,
    sessionProps: {
      navList: currentSessions,
      sidebarExpanded,
      sidebarHovering,
      nav: () => state.nav,
      hoverSession: () => state.hoverSession,
      setHoverSession,
      clearHoverProjectSoon,
      prefetchSession,
      archiveSession,
    },
    setHoverSession,
  }

  const sidebarPanelCtx: SidebarPanelCtx = {
    language,
    globalSDK,
    globalSync,
    notification,
    providers,
    sidebarHovering,
    sidebarOpened: () => layout.sidebar.opened(),
    sidebarWidth: () => layout.sidebar.width(),
    sidebarWorkspaces: (worktree) => layout.sidebar.workspaces(worktree),
    sidebarToggleWorkspaces: (worktree) => layout.sidebar.toggleWorkspaces(worktree),
    workspaceIds,
    workspaceSidebarCtx,
    sidebarProject,
    workspaceLabel,
    sortNow,
    activeWorkspace: () => store.activeWorkspace,
    gettingStartedDismissed: () => store.gettingStartedDismissed,
    InlineEditor,
    renameProject,
    closeProject,
    showEditProjectDialog,
    toggleProjectWorkspaces,
    createWorkspace,
    connectProvider,
    navigateWithSidebarReset,
    setScrollContainerRef: (el, mobile) => setScrollContainerRef(el, mobile),
    handleWorkspaceDragStart,
    handleWorkspaceDragEnd,
    handleWorkspaceDragOver,
  }

  return {
    workspaceIds,
    sidebarProject,
    handleWorkspaceDragStart,
    handleWorkspaceDragOver,
    handleWorkspaceDragEnd,
    workspaceSidebarCtx,
    projectSidebarCtx,
    sidebarPanelCtx,
  }
}
