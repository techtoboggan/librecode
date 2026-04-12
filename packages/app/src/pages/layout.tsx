import { createEffect, createMemo, on, onCleanup, onMount, ParentProps, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useLayout, LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { Persist, persisted } from "@/utils/persist"
import { base64Encode } from "@librecode/util/encode"
import { decode64 } from "@/utils/base64"
import { ResizeHandle } from "@librecode/ui/resize-handle"
import { Session } from "@librecode/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { createStore, produce, type SetStoreFunction } from "solid-js/store"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useProviders } from "@/hooks/use-providers"
import { showToast, Toast } from "@librecode/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { createAim } from "@/utils/aim"
import { setNavigate } from "@/utils/notification-click"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { setSessionHandoff } from "@/pages/session/handoff"

import { useDialog } from "@librecode/ui/context/dialog"
import { useTheme, type ColorScheme } from "@librecode/ui/theme"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogSettings } from "@/components/dialog-settings"
import { useCommand } from "@/context/command"
import { getDraggableId } from "@/utils/solid-dnd"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogEditProject } from "@/components/dialog-edit-project"
import { DebugBar } from "@/components/debug-bar"
import { Titlebar } from "@/components/titlebar"
import { useServer } from "@/context/server"
import { useLanguage } from "@/context/language"
import { effectiveWorkspaceOrder, errorMessage, sortedRootSessions, workspaceKey } from "./layout/helpers"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
} from "./layout/deep-links"
import { createInlineEditorController } from "./layout/inline-editor"
import { ProjectDragOverlay, SortableProject } from "./layout/sidebar-project"
import { SidebarContent } from "./layout/sidebar-shell"
import { useUpdatePolling, useSDKNotificationToasts } from "./layout/notifications"
import { createPrefetchController } from "./layout/prefetch"
import { registerLayoutCommands } from "./layout/commands"
import { SidebarPanel } from "./layout/sidebar-panel"
import { createProjectActions } from "./layout/project-actions"
import { createSidebarContexts, type SidebarContextDeps } from "./layout/sidebar-context"

export default function Layout(props: ParentProps) {
  const [store, setStore, , ready] = persisted(
    Persist.global("layout.page", ["layout.page.v1"]),
    createStore({
      lastProjectSession: {} as { [directory: string]: { directory: string; id: string; at: number } },
      activeProject: undefined as string | undefined,
      activeWorkspace: undefined as string | undefined,
      workspaceOrder: {} as Record<string, string[]>,
      workspaceName: {} as Record<string, string>,
      workspaceBranchName: {} as Record<string, Record<string, string>>,
      workspaceExpanded: {} as Record<string, boolean>,
      gettingStartedDismissed: false,
    }),
  )

  const pageReady = createMemo(() => ready())

  let scrollContainerRef: HTMLDivElement | undefined

  const params = useParams()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const layoutReady = createMemo(() => layout.ready())
  const platform = usePlatform()
  const settings = useSettings()
  const server = useServer()
  const notification = useNotification()
  const permission = usePermission()
  const navigate = useNavigate()
  setNavigate(navigate)
  const providers = useProviders()
  const dialog = useDialog()
  const command = useCommand()
  const theme = useTheme()
  const language = useLanguage()
  const initialDirectory = decode64(params.dir)
  const availableThemeEntries = createMemo(() => Object.entries(theme.themes()))
  const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
  const colorSchemeKey: Record<ColorScheme, "theme.scheme.system" | "theme.scheme.light" | "theme.scheme.dark"> = {
    system: "theme.scheme.system",
    light: "theme.scheme.light",
    dark: "theme.scheme.dark",
  }
  const colorSchemeLabel = (scheme: ColorScheme) => language.t(colorSchemeKey[scheme])
  const currentDir = createMemo(() => decode64(params.dir) ?? "")

  const [state, setState] = createStore({
    autoselect: !initialDirectory,
    busyWorkspaces: {} as Record<string, boolean>,
    hoverSession: undefined as string | undefined,
    hoverProject: undefined as string | undefined,
    scrollSessionKey: undefined as string | undefined,
    nav: undefined as HTMLElement | undefined,
    sortNow: Date.now(),
    sizing: false,
    peek: undefined as string | undefined,
    peeked: false,
  })

  const editor = createInlineEditorController()
  const setBusy = (directory: string, value: boolean) => {
    const key = workspaceKey(directory)
    if (value) {
      setState("busyWorkspaces", key, true)
      return
    }
    setState(
      "busyWorkspaces",
      produce((draft) => {
        delete draft[key]
      }),
    )
  }
  const isBusy = (directory: string) => !!state.busyWorkspaces[workspaceKey(directory)]
  const navLeave = { current: undefined as number | undefined }
  const sortNow = () => state.sortNow
  let sizet: number | undefined
  let sortNowInterval: ReturnType<typeof setInterval> | undefined
  const sortNowTimeout = setTimeout(
    () => {
      setState("sortNow", Date.now())
      sortNowInterval = setInterval(() => setState("sortNow", Date.now()), 60_000)
    },
    60_000 - (Date.now() % 60_000),
  )

  const aim = createAim({
    enabled: () => !layout.sidebar.opened(),
    active: () => state.hoverProject,
    el: () => state.nav?.querySelector<HTMLElement>("[data-component='sidebar-rail']") ?? state.nav,
    onActivate: (directory) => {
      globalSync.child(directory)
      setState("hoverProject", directory)
      setState("hoverSession", undefined)
    },
  })

  onCleanup(() => {
    if (navLeave.current !== undefined) clearTimeout(navLeave.current)
    clearTimeout(sortNowTimeout)
    if (sortNowInterval) clearInterval(sortNowInterval)
    if (sizet !== undefined) clearTimeout(sizet)
    if (peekt !== undefined) clearTimeout(peekt)
    aim.reset()
  })

  onMount(() => {
    const stop = () => setState("sizing", false)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("blur", stop)
    onCleanup(() => {
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("blur", stop)
    })
  })

  const sidebarHovering = createMemo(() => !layout.sidebar.opened() && state.hoverProject !== undefined)
  const sidebarExpanded = createMemo(() => layout.sidebar.opened() || sidebarHovering())
  const setHoverProject = (value: string | undefined) => {
    setState("hoverProject", value)
    if (value !== undefined) return
    aim.reset()
  }
  const clearHoverProjectSoon = () => queueMicrotask(() => setHoverProject(undefined))
  const setHoverSession = (id: string | undefined) => setState("hoverSession", id)

  const disarm = () => {
    if (navLeave.current === undefined) return
    clearTimeout(navLeave.current)
    navLeave.current = undefined
  }

  const arm = () => {
    if (layout.sidebar.opened()) return
    if (state.hoverProject === undefined) return
    disarm()
    navLeave.current = window.setTimeout(() => {
      navLeave.current = undefined
      setHoverProject(undefined)
      setState("hoverSession", undefined)
    }, 300)
  }

  let peekt: number | undefined

  const hoverProjectData = createMemo(() => {
    const id = state.hoverProject
    if (!id) return
    return layout.projects.list().find((project) => project.worktree === id)
  })

  const peekProject = createMemo(() => {
    const id = state.peek
    if (!id) return
    return layout.projects.list().find((project) => project.worktree === id)
  })

  createEffect(() => {
    const p = hoverProjectData()
    if (p) {
      if (peekt !== undefined) {
        clearTimeout(peekt)
        peekt = undefined
      }
      setState("peek", p.worktree)
      setState("peeked", true)
      return
    }

    setState("peeked", false)
    if (state.peek === undefined) return
    if (peekt !== undefined) clearTimeout(peekt)
    peekt = window.setTimeout(() => {
      peekt = undefined
      setState("peek", undefined)
    }, 180)
  })

  createEffect(() => {
    if (!layout.sidebar.opened()) return
    setHoverProject(undefined)
  })

  const autoselecting = createMemo(() => {
    if (params.dir) return false
    if (!state.autoselect) return false
    if (!pageReady()) return true
    if (!layoutReady()) return true
    const list = layout.projects.list()
    if (list.length > 0) return true
    return !!server.projects.last()
  })

  createEffect(() => {
    if (!state.autoselect) return
    const dir = params.dir
    if (!dir) return
    const directory = decode64(dir)
    if (!directory) return
    setState("autoselect", false)
  })

  const editorOpen = editor.editorOpen
  const openEditor = editor.openEditor
  const closeEditor = editor.closeEditor
  const setEditor = editor.setEditor
  const InlineEditor = editor.InlineEditor

  const clearSidebarHoverState = () => {
    if (layout.sidebar.opened()) return
    setState("hoverSession", undefined)
    setHoverProject(undefined)
  }

  const navigateWithSidebarReset = (href: string) => {
    clearSidebarHoverState()
    navigate(href)
    layout.mobileSidebar.hide()
  }

  // ---- Notification hooks ----

  const notifDeps = {
    params,
    currentDir,
    globalSDK,
    globalSync,
    platform,
    settings,
    language,
    permission,
    navigate,
    setBusy,
  }
  useUpdatePolling(notifDeps)
  useSDKNotificationToasts(notifDeps)

  function scrollToSession(sessionId: string, sessionKey: string) {
    if (!scrollContainerRef) return
    if (state.scrollSessionKey === sessionKey) return
    const element = scrollContainerRef.querySelector(`[data-session-id="${sessionId}"]`)
    if (!element) return
    const containerRect = scrollContainerRef.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    if (elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom) {
      setState("scrollSessionKey", sessionKey)
      return
    }
    setState("scrollSessionKey", sessionKey)
    element.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  const currentProject = createMemo(() => {
    const directory = currentDir()
    if (!directory) return

    const projects = layout.projects.list()

    const sandbox = projects.find((p) => p.sandboxes?.includes(directory))
    if (sandbox) return sandbox

    const direct = projects.find((p) => p.worktree === directory)
    if (direct) return direct

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return

    const meta = globalSync.data.project.find((p) => p.id === id)
    const root = meta?.worktree
    if (!root) return

    return projects.find((p) => p.worktree === root)
  })

  createEffect(
    on(
      () => ({ ready: pageReady(), layoutReady: layoutReady(), dir: params.dir, list: layout.projects.list() }),
      (value) => {
        if (!value.ready) return
        if (!value.layoutReady) return
        if (!state.autoselect) return
        if (value.dir) return

        const last = server.projects.last()

        if (value.list.length === 0) {
          if (!last) return
          setState("autoselect", false)
          openProject(last, false)
          navigateToProject(last)
          return
        }

        const next = value.list.find((project) => project.worktree === last) ?? value.list[0]
        if (!next) return
        setState("autoselect", false)
        openProject(next.worktree, false)
        navigateToProject(next.worktree)
      },
    ),
  )

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

  const workspaceSetting = createMemo(() => {
    const project = currentProject()
    if (!project) return false
    if (project.vcs !== "git") return false
    return layout.sidebar.workspaces(project.worktree)()
  })

  const visibleSessionDirs = createMemo(() => {
    const project = currentProject()
    if (!project) return [] as string[]
    if (!workspaceSetting()) return [project.worktree]

    const activeDir = currentDir()
    return workspaceIds(project).filter((directory) => {
      const expanded = store.workspaceExpanded[directory] ?? directory === project.worktree
      const active = directory === activeDir
      return expanded || active
    })
  })

  createEffect(() => {
    if (!pageReady()) return
    if (!layoutReady()) return
    const projects = layout.projects.list()
    for (const [directory, expanded] of Object.entries(store.workspaceExpanded)) {
      if (!expanded) continue
      const project = projects.find((item) => item.worktree === directory || item.sandboxes?.includes(directory))
      if (!project) continue
      if (project.vcs === "git" && layout.sidebar.workspaces(project.worktree)()) continue
      setStore("workspaceExpanded", directory, false)
    }
  })

  const currentSessions = createMemo(() => {
    const now = Date.now()
    const dirs = visibleSessionDirs()
    if (dirs.length === 0) return [] as Session[]

    const result: Session[] = []
    for (const dir of dirs) {
      const [dirStore] = globalSync.child(dir, { bootstrap: true })
      const dirSessions = sortedRootSessions(dirStore, now)
      result.push(...dirSessions)
    }
    return result
  })

  // ---- Prefetch controller ----

  const prefetch = createPrefetchController({
    params,
    globalSDK,
    globalSync,
    visibleSessionDirs,
  })
  prefetch.pruneOnDirChange()

  createEffect(() => {
    params.dir
    globalSDK.url
    prefetch.resetOnUrlChange()
  })

  createEffect(() => {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const index = params.id ? sessions.findIndex((s) => s.id === params.id) : 0
    if (index === -1) return

    if (!params.id) {
      const first = sessions[index]
      if (first) prefetch.prefetchSession(first, "high")
    }

    prefetch.warm(sessions, index)
  })

  // ---- Project actions factory ----

  const projectActions = createProjectActions({
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
  })

  const {
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
  } = projectActions

  function navigateSessionByOffset(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const sessionIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1
    let targetIndex: number
    if (sessionIndex === -1) {
      targetIndex = offset > 0 ? 0 : sessions.length - 1
    } else {
      targetIndex = (sessionIndex + offset + sessions.length) % sessions.length
    }

    const session = sessions[targetIndex]
    if (!session) return

    prefetch.prefetchSession(session, "high")
    prefetch.warm(sessions, targetIndex)
    navigateToSession(session)
  }

  function navigateSessionByUnseen(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const hasUnseen = sessions.some((session) => notification.session.unseenCount(session.id) > 0)
    if (!hasUnseen) return

    const activeIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1
    const start = activeIndex === -1 ? (offset > 0 ? -1 : 0) : activeIndex

    for (let i = 1; i <= sessions.length; i++) {
      const index = offset > 0 ? (start + i) % sessions.length : (start - i + sessions.length) % sessions.length
      const session = sessions[index]
      if (!session) continue
      if (notification.session.unseenCount(session.id) === 0) continue

      prefetch.prefetchSession(session, "high")
      prefetch.warm(sessions, index)
      navigateToSession(session)
      return
    }
  }

  // ---- Dialog helpers ----

  function connectProvider() {
    dialog.show(() => <DialogSelectProvider />)
  }

  function openServer() {
    dialog.show(() => <DialogSelectServer />)
  }

  function openSettings() {
    dialog.show(() => <DialogSettings />)
  }

  const showEditProjectDialog = (project: LocalProject) => dialog.show(() => <DialogEditProject project={project} />)

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory, false)
        }
        navigateToProject(result[0])
      } else if (result) {
        openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  const handleDeepLinks = (urls: string[]) => {
    if (!server.isLocal()) return

    for (const directory of collectOpenProjectDeepLinks(urls)) {
      openProject(directory)
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      openProject(link.directory, false)
      const slug = base64Encode(link.directory)
      if (link.prompt) {
        setSessionHandoff(slug, { prompt: link.prompt })
      }
      const href = link.prompt ? `/${slug}/session?prompt=${encodeURIComponent(link.prompt)}` : `/${slug}/session`
      navigateWithSidebarReset(href)
    }
  }

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ urls: string[] }>).detail
      const urls = detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(urls)
    }

    handleDeepLinks(drainPendingDeepLinks(window))
    window.addEventListener(deepLinkEvent, handler as EventListener)
    onCleanup(() => window.removeEventListener(deepLinkEvent, handler as EventListener))
  })

  const activeRoute = {
    session: "",
    sessionProject: "",
  }

  createEffect(
    on(
      () => [pageReady(), params.dir, params.id, currentProject()?.worktree] as const,
      ([ready, dir, id]) => {
        if (!ready || !dir) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          return
        }

        const directory = decode64(dir)
        if (!directory) return

        const root = touchProjectRoute() ?? activeProjectRoot(directory)

        if (!id) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          return
        }

        const session = `${dir}/${id}`
        if (session !== activeRoute.session) {
          activeRoute.session = session
          activeRoute.sessionProject = syncSessionRoute(directory, id, root)
          return
        }

        if (root === activeRoute.sessionProject) return
        activeRoute.sessionProject = rememberSessionRoute(directory, id, root)
      },
    ),
  )

  createEffect(() => {
    const sidebarWidth = layout.sidebar.opened() ? layout.sidebar.width() : 48
    document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
  })

  const loadedSessionDirs = new Set<string>()

  createEffect(
    on(
      visibleSessionDirs,
      (dirs) => {
        if (dirs.length === 0) {
          loadedSessionDirs.clear()
          return
        }

        const next = new Set(dirs)
        for (const directory of next) {
          if (loadedSessionDirs.has(directory)) continue
          globalSync.project.loadSessions(directory)
        }

        loadedSessionDirs.clear()
        for (const directory of next) {
          loadedSessionDirs.add(directory)
        }
      },
      { defer: true },
    ),
  )

  function handleDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setHoverProject(undefined)
    setStore("activeProject", id)
  }

  function handleDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const projects = layout.projects.list()
      const fromIndex = projects.findIndex((p) => p.worktree === draggable.id.toString())
      const toIndex = projects.findIndex((p) => p.worktree === droppable.id.toString())
      if (fromIndex !== toIndex && toIndex !== -1) {
        layout.projects.move(draggable.id.toString(), toIndex)
      }
    }
  }

  function handleDragEnd() {
    setStore("activeProject", undefined)
  }

  const createWorkspace = async (project: { worktree: string; id?: string; vcs?: "git" }) => {
    clearSidebarHoverState()
    const created = await globalSDK.client.worktree
      .create({ directory: project.worktree })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.create.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return undefined
      })

    if (!created?.directory) return

    setWorkspaceName(created.directory, created.branch, project.id, created.branch)

    const local = project.worktree
    const key = workspaceKey(created.directory)
    const root = workspaceKey(local)

    setBusy(created.directory, true)
    WorktreeState.pending(created.directory)
    setStore("workspaceExpanded", key, true)
    if (key !== created.directory) {
      setStore("workspaceExpanded", created.directory, true)
    }
    setStore("workspaceOrder", project.worktree, (prev) => {
      const existing = prev ?? []
      const next = existing.filter((item) => {
        const id = workspaceKey(item)
        return id !== root && id !== key
      })
      return [created.directory, ...next]
    })

    globalSync.child(created.directory)
    navigateWithSidebarReset(`/${base64Encode(created.directory)}/session`)
  }

  // ---- Sidebar contexts factory ----

  const {
    sidebarProject,
    handleWorkspaceDragStart,
    handleWorkspaceDragOver,
    handleWorkspaceDragEnd,
    workspaceSidebarCtx,
    projectSidebarCtx,
    sidebarPanelCtx,
  } = createSidebarContexts({
    params,
    store,
    setStore: setStore as unknown as SidebarContextDeps["setStore"],
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
    prefetchSession: prefetch.prefetchSession,
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
    setScrollContainerRef: (el: HTMLDivElement | undefined, mobile?: boolean) => {
      if (!mobile) scrollContainerRef = el
    },
  })

  // ---- Commands registration ----

  registerLayoutCommands({
    params,
    command,
    theme,
    language,
    layout,
    colorSchemeOrder,
    colorSchemeLabel,
    availableThemeEntries,
    currentSessions,
    currentProject,
    workspaceSetting,
    navigateSessionByOffset,
    navigateSessionByUnseen,
    archiveSession,
    createWorkspace,
    chooseProject,
    connectProvider,
    openServer,
    openSettings,
  })

  const projects = () => layout.projects.list()
  const projectOverlay = () => <ProjectDragOverlay projects={projects} activeProject={() => store.activeProject} />
  const sidebarContent = (mobile?: boolean) => (
    <SidebarContent
      mobile={mobile}
      opened={() => layout.sidebar.opened()}
      aimMove={aim.move}
      projects={projects}
      renderProject={(project) => (
        <SortableProject ctx={projectSidebarCtx} project={project} sortNow={sortNow} mobile={mobile} />
      )}
      handleDragStart={handleDragStart}
      handleDragEnd={handleDragEnd}
      handleDragOver={handleDragOver}
      openProjectLabel={language.t("command.project.open")}
      openProjectKeybind={() => command.keybind("project.open")}
      onOpenProject={chooseProject}
      renderProjectOverlay={projectOverlay}
      settingsLabel={() => language.t("sidebar.settings")}
      settingsKeybind={() => command.keybind("settings.open")}
      onOpenSettings={openSettings}
      helpLabel={() => language.t("sidebar.help")}
      onOpenHelp={() => platform.openLink("https://github.com/techtoboggan/librecode/desktop-feedback")}
      renderPanel={() =>
        mobile ? (
          <SidebarPanel project={currentProject} mobile ctx={sidebarPanelCtx} />
        ) : (
          <Show when={currentProject()}>
            <SidebarPanel project={currentProject} merged ctx={sidebarPanelCtx} />
          </Show>
        )
      }
    />
  )

  return (
    <div class="relative bg-background-base flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <Titlebar />
      <div class="flex-1 min-h-0 min-w-0 flex">
        <div class="flex-1 min-h-0 relative">
          <div class="size-full relative overflow-x-hidden">
            <nav
              aria-label={language.t("sidebar.nav.projectsAndSessions")}
              data-component="sidebar-nav-desktop"
              classList={{
                "hidden xl:block": true,
                "absolute inset-y-0 left-0": true,
                "z-10": true,
              }}
              style={{ width: `${Math.max(layout.sidebar.width(), 244)}px` }}
              ref={(el) => {
                setState("nav", el)
              }}
              onMouseEnter={() => {
                disarm()
              }}
              onMouseLeave={() => {
                aim.reset()
                if (!sidebarHovering()) return
                arm()
              }}
            >
              <div class="@container w-full h-full contain-strict">{sidebarContent()}</div>
              <Show when={layout.sidebar.opened()}>
                <div onPointerDown={() => setState("sizing", true)}>
                  <ResizeHandle
                    direction="horizontal"
                    size={layout.sidebar.width()}
                    min={244}
                    max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.3 + 64}
                    collapseThreshold={244}
                    onResize={(w) => {
                      setState("sizing", true)
                      if (sizet !== undefined) clearTimeout(sizet)
                      sizet = window.setTimeout(() => setState("sizing", false), 120)
                      layout.sidebar.resize(w)
                    }}
                    onCollapse={layout.sidebar.close}
                  />
                </div>
              </Show>
            </nav>

            <div
              class="hidden xl:block pointer-events-none absolute top-0 right-0 z-0 border-t border-border-weaker-base"
              style={{ left: "calc(4rem + 12px)" }}
            />

            <div class="xl:hidden">
              <div
                classList={{
                  "fixed inset-x-0 top-10 bottom-0 z-40 transition-opacity duration-200": true,
                  "opacity-100 pointer-events-auto": layout.mobileSidebar.opened(),
                  "opacity-0 pointer-events-none": !layout.mobileSidebar.opened(),
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) layout.mobileSidebar.hide()
                }}
              />
              <nav
                aria-label={language.t("sidebar.nav.projectsAndSessions")}
                data-component="sidebar-nav-mobile"
                classList={{
                  "@container fixed top-10 bottom-0 left-0 z-50 w-full max-w-[400px] overflow-hidden border-r border-border-weaker-base bg-background-base transition-transform duration-200 ease-out": true,
                  "translate-x-0": layout.mobileSidebar.opened(),
                  "-translate-x-full": !layout.mobileSidebar.opened(),
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {sidebarContent(true)}
              </nav>
            </div>

            <div
              classList={{
                "absolute inset-0": true,
                "xl:inset-y-0 xl:right-0 xl:left-[var(--main-left)]": true,
                "z-20": true,
                "transition-[left] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[left] motion-reduce:transition-none":
                  !state.sizing,
              }}
              style={{
                "--main-left": layout.sidebar.opened() ? `${Math.max(layout.sidebar.width(), 244)}px` : "4rem",
              }}
            >
              <main
                classList={{
                  "size-full overflow-x-hidden flex flex-col items-start contain-strict border-t border-border-weak-base bg-background-base xl:border-l xl:rounded-tl-[12px]": true,
                }}
              >
                <Show when={!autoselecting()} fallback={<div class="size-full" />}>
                  {props.children}
                </Show>
              </main>
            </div>

            <div
              classList={{
                "hidden xl:flex absolute inset-y-0 left-16 z-30": true,
                "opacity-100 translate-x-0 pointer-events-auto": state.peeked && !layout.sidebar.opened(),
                "opacity-0 -translate-x-2 pointer-events-none": !state.peeked || layout.sidebar.opened(),
                "transition-[opacity,transform] motion-reduce:transition-none": true,
                "duration-180 ease-out": state.peeked && !layout.sidebar.opened(),
                "duration-120 ease-in": !state.peeked || layout.sidebar.opened(),
              }}
              onMouseMove={disarm}
              onMouseEnter={() => {
                disarm()
                aim.reset()
              }}
              onPointerDown={disarm}
              onMouseLeave={() => {
                arm()
              }}
            >
              <Show when={peekProject()}>
                <SidebarPanel project={peekProject} merged={false} ctx={sidebarPanelCtx} />
              </Show>
            </div>

            <div
              classList={{
                "hidden xl:block pointer-events-none absolute inset-y-0 right-0 z-25 overflow-hidden": true,
                "opacity-100 translate-x-0": state.peeked && !layout.sidebar.opened(),
                "opacity-0 -translate-x-2": !state.peeked || layout.sidebar.opened(),
                "transition-[opacity,transform] motion-reduce:transition-none": true,
                "duration-180 ease-out": state.peeked && !layout.sidebar.opened(),
                "duration-120 ease-in": !state.peeked || layout.sidebar.opened(),
              }}
              style={{ left: `calc(4rem + ${Math.max(Math.max(layout.sidebar.width(), 244) - 64, 0)}px)` }}
            >
              <div class="h-full w-px" style={{ "box-shadow": "var(--shadow-sidebar-overlay)" }} />
            </div>
          </div>
        </div>
        {import.meta.env.DEV && <DebugBar />}
      </div>
      <Toast.Region />
    </div>
  )
}
