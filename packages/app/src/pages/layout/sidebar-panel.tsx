import { createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { onMount } from "solid-js"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { base64Encode } from "@librecode/util/encode"
import { getFilename } from "@librecode/util/path"
import { Button } from "@librecode/ui/button"
import { IconButton } from "@librecode/ui/icon-button"
import { Tooltip } from "@librecode/ui/tooltip"
import { DropdownMenu } from "@librecode/ui/dropdown-menu"
import { Dialog } from "@librecode/ui/dialog"
import { useDialog } from "@librecode/ui/context/dialog"
import { type Session } from "@librecode/sdk/v2/client"
import { type LocalProject } from "@/context/layout"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import {
  LocalWorkspace,
  SortableWorkspace,
  WorkspaceDragOverlay,
  type WorkspaceSidebarContext,
} from "./sidebar-workspace"
import { workspaceKey } from "./helpers"
import type { useLanguage } from "@/context/language"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { useNotification } from "@/context/notification"
import type { useProviders } from "@/hooks/use-providers"

type Language = ReturnType<typeof useLanguage>
type GlobalSDK = ReturnType<typeof useGlobalSDK>
type GlobalSync = ReturnType<typeof useGlobalSync>
type Notification = ReturnType<typeof useNotification>
type Providers = ReturnType<typeof useProviders>

export type SidebarPanelCtx = {
  language: Language
  globalSDK: GlobalSDK
  globalSync: GlobalSync
  notification: Notification
  providers: Providers
  sidebarHovering: () => boolean
  sidebarOpened: () => boolean
  sidebarWidth: () => number
  sidebarWorkspaces: (worktree: string) => () => boolean
  sidebarToggleWorkspaces: (worktree: string) => void
  workspaceIds: (project: LocalProject) => string[]
  workspaceSidebarCtx: WorkspaceSidebarContext
  sidebarProject: Accessor<LocalProject | undefined>
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  sortNow: () => number
  activeWorkspace: () => string | undefined
  gettingStartedDismissed: () => boolean
  InlineEditor: (props: {
    id: string
    value: Accessor<string>
    onSave: (next: string) => void
    class?: string
    displayClass?: string
    stopPropagation?: boolean
  }) => JSX.Element
  renameProject: (project: LocalProject, next: string) => Promise<void>
  closeProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  createWorkspace: (project: LocalProject) => Promise<void>
  connectProvider: () => void
  navigateWithSidebarReset: (href: string) => void
  setScrollContainerRef: (el: HTMLDivElement, mobile: boolean) => void
  handleWorkspaceDragStart: (event: unknown) => void
  handleWorkspaceDragEnd: () => void
  handleWorkspaceDragOver: (event: DragEvent) => void
}

// ---- Dialog components ----

type WorkspaceDialogProps = {
  root: string
  directory: string
  ctx: Pick<SidebarPanelCtx, "globalSDK" | "language"> & {
    params: { dir?: string }
    currentDir: () => string
    navigateWithSidebarReset: (href: string) => void
    deleteWorkspace: (root: string, directory: string, leave?: boolean) => Promise<void>
  }
}

export function DialogDeleteWorkspace(props: WorkspaceDialogProps): JSX.Element {
  const dialog = useDialog()
  const { globalSDK, language } = props.ctx
  const name = createMemo(() => getFilename(props.directory))
  const [data, setData] = createStore({
    status: "loading" as "loading" | "ready" | "error",
    dirty: false,
  })

  onMount(() => {
    globalSDK.client.file
      .status({ directory: props.directory })
      .then((x) => {
        const files = x.data ?? []
        const dirty = files.length > 0
        setData({ status: "ready", dirty })
      })
      .catch(() => {
        setData({ status: "error", dirty: false })
      })
  })

  const handleDelete = () => {
    const { params, currentDir, navigateWithSidebarReset, deleteWorkspace } = props.ctx
    const leaveDeletedWorkspace = !!params.dir && workspaceKey(currentDir()) === workspaceKey(props.directory)
    if (leaveDeletedWorkspace) {
      navigateWithSidebarReset(`/${base64Encode(props.root)}/session`)
    }
    dialog.close()
    void deleteWorkspace(props.root, props.directory, leaveDeletedWorkspace)
  }

  const description = () => {
    if (data.status === "loading") return language.t("workspace.status.checking")
    if (data.status === "error") return language.t("workspace.status.error")
    if (!data.dirty) return language.t("workspace.status.clean")
    return language.t("workspace.status.dirty")
  }

  return (
    <Dialog title={language.t("workspace.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("workspace.delete.confirm", { name: name() })}
          </span>
          <span class="text-12-regular text-text-weak">{description()}</span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={data.status === "loading"} onClick={handleDelete}>
            {language.t("workspace.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

type ResetDialogProps = {
  root: string
  directory: string
  ctx: Pick<SidebarPanelCtx, "globalSDK" | "language"> & {
    resetWorkspace: (root: string, directory: string) => Promise<void>
  }
}

export function DialogResetWorkspace(props: ResetDialogProps): JSX.Element {
  const dialog = useDialog()
  const { globalSDK, language } = props.ctx
  const name = createMemo(() => getFilename(props.directory))
  const [state, setState] = createStore({
    status: "loading" as "loading" | "ready" | "error",
    dirty: false,
    sessions: [] as Session[],
  })

  const refresh = async () => {
    const sessions = await globalSDK.client.session
      .list({ directory: props.directory })
      .then((x) => x.data ?? [])
      .catch(() => [])
    const active = sessions.filter((session) => session.time.archived === undefined)
    setState({ sessions: active })
  }

  onMount(() => {
    globalSDK.client.file
      .status({ directory: props.directory })
      .then((x) => {
        const files = x.data ?? []
        const dirty = files.length > 0
        setState({ status: "ready", dirty })
        void refresh()
      })
      .catch(() => {
        setState({ status: "error", dirty: false })
      })
  })

  const handleReset = () => {
    dialog.close()
    void props.ctx.resetWorkspace(props.root, props.directory)
  }

  const archivedCount = () => state.sessions.length

  const description = () => {
    if (state.status === "loading") return language.t("workspace.status.checking")
    if (state.status === "error") return language.t("workspace.status.error")
    if (!state.dirty) return language.t("workspace.status.clean")
    return language.t("workspace.status.dirty")
  }

  const archivedLabel = () => {
    const count = archivedCount()
    if (count === 0) return language.t("workspace.reset.archived.none")
    if (count === 1) return language.t("workspace.reset.archived.one")
    return language.t("workspace.reset.archived.many", { count })
  }

  return (
    <Dialog title={language.t("workspace.reset.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("workspace.reset.confirm", { name: name() })}
          </span>
          <span class="text-12-regular text-text-weak">
            {description()} {archivedLabel()} {language.t("workspace.reset.note")}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={state.status === "loading"} onClick={handleReset}>
            {language.t("workspace.reset.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ---- SidebarPanel component ----

export type SidebarPanelProps = {
  project: Accessor<LocalProject | undefined>
  mobile?: boolean
  merged?: boolean
  ctx: SidebarPanelCtx
}

export function SidebarPanel(panelProps: SidebarPanelProps): JSX.Element {
  const { ctx } = panelProps
  const {
    language,
    globalSync,
    notification,
    providers,
    sidebarHovering,
    sidebarOpened,
    sidebarWidth,
    sidebarWorkspaces,
    sidebarToggleWorkspaces,
    workspaceIds,
    workspaceSidebarCtx,
    sidebarProject,
    workspaceLabel,
    sortNow,
    activeWorkspace,
    gettingStartedDismissed,
    InlineEditor,
    renameProject,
    closeProject,
    showEditProjectDialog,
    toggleProjectWorkspaces,
    createWorkspace,
    connectProvider,
    navigateWithSidebarReset,
    setScrollContainerRef,
    handleWorkspaceDragStart,
    handleWorkspaceDragEnd,
    handleWorkspaceDragOver,
  } = ctx

  const project = panelProps.project
  const merged = createMemo(() => panelProps.mobile || (panelProps.merged ?? sidebarOpened()))
  const hover = createMemo(() => !panelProps.mobile && panelProps.merged === false && !sidebarOpened())
  const popover = createMemo(() => !!panelProps.mobile || panelProps.merged === false || sidebarOpened())
  const projectName = createMemo(() => {
    const item = project()
    if (!item) return ""
    return item.name || getFilename(item.worktree)
  })
  const projectId = createMemo(() => project()?.id ?? "")
  const worktree = createMemo(() => project()?.worktree ?? "")
  const slug = createMemo(() => {
    const dir = worktree()
    if (!dir) return ""
    return base64Encode(dir)
  })
  const workspaces = createMemo(() => {
    const item = project()
    if (!item) return [] as string[]
    return workspaceIds(item)
  })
  const unseenCount = createMemo(() =>
    workspaces().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const clearNotifications = () =>
    workspaces()
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))
  const workspacesEnabled = createMemo(() => {
    const item = project()
    if (!item) return false
    if (item.vcs !== "git") return false
    return sidebarWorkspaces(item.worktree)()
  })
  const canToggle = createMemo(() => {
    const item = project()
    if (!item) return false
    return item.vcs === "git" || sidebarWorkspaces(item.worktree)()
  })
  const homedir = createMemo(() => globalSync.data.path.home)

  return (
    <div
      classList={{
        "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] px-3": true,
        "border border-b-0 border-border-weak-base": !merged(),
        "border-l border-t border-border-weaker-base": merged(),
        "bg-background-base": merged() || hover(),
        "bg-background-stronger": !merged() && !hover(),
        "flex-1 min-w-0": panelProps.mobile,
        "max-w-full overflow-hidden": panelProps.mobile,
      }}
      style={{
        width: panelProps.mobile ? undefined : `${Math.max(Math.max(sidebarWidth(), 244) - 64, 0)}px`,
      }}
    >
      <Show when={project()}>
        <>
          <div class="shrink-0 pl-1 py-1">
            <div class="group/project flex items-start justify-between gap-2 py-2 pl-2 pr-0">
              <div class="flex flex-col min-w-0">
                <InlineEditor
                  id={`project:${projectId()}`}
                  value={projectName}
                  onSave={(next) => {
                    const item = project()
                    if (!item) return
                    renameProject(item, next)
                  }}
                  class="text-14-medium text-text-strong truncate"
                  displayClass="text-14-medium text-text-strong truncate"
                  stopPropagation
                />

                <Tooltip
                  placement="bottom"
                  gutter={2}
                  value={worktree()}
                  class="shrink-0"
                  contentStyle={{
                    "max-width": "640px",
                    transform: "translate3d(52px, 0, 0)",
                  }}
                >
                  <span class="text-12-regular text-text-base truncate select-text">
                    {worktree().replace(homedir(), "~")}
                  </span>
                </Tooltip>
              </div>

              <DropdownMenu modal={!sidebarHovering()}>
                <DropdownMenu.Trigger
                  as={IconButton}
                  icon="dot-grid"
                  variant="ghost"
                  data-action="project-menu"
                  data-project={slug()}
                  class="shrink-0 size-6 rounded-md data-[expanded]:bg-surface-base-active"
                  classList={{
                    "opacity-0 group-hover/project:opacity-100 data-[expanded]:opacity-100": !panelProps.mobile,
                  }}
                  aria-label={language.t("common.moreOptions")}
                />
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="mt-1">
                    <DropdownMenu.Item
                      onSelect={() => {
                        const item = project()
                        if (!item) return
                        showEditProjectDialog(item)
                      }}
                    >
                      <DropdownMenu.ItemLabel>{language.t("common.edit")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      data-action="project-workspaces-toggle"
                      data-project={slug()}
                      disabled={!canToggle()}
                      onSelect={() => {
                        const item = project()
                        if (!item) return
                        toggleProjectWorkspaces(item)
                      }}
                    >
                      <DropdownMenu.ItemLabel>
                        {workspacesEnabled()
                          ? language.t("sidebar.workspaces.disable")
                          : language.t("sidebar.workspaces.enable")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      data-action="project-clear-notifications"
                      data-project={slug()}
                      disabled={unseenCount() === 0}
                      onSelect={clearNotifications}
                    >
                      <DropdownMenu.ItemLabel>
                        {language.t("sidebar.project.clearNotifications")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      data-action="project-close-menu"
                      data-project={slug()}
                      onSelect={() => {
                        const dir = worktree()
                        if (!dir) return
                        closeProject(dir)
                      }}
                    >
                      <DropdownMenu.ItemLabel>{language.t("common.close")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </div>
          </div>

          <div class="flex-1 min-h-0 flex flex-col">
            <Show
              when={workspacesEnabled()}
              fallback={
                <>
                  <div class="shrink-0 py-4">
                    <Button
                      size="large"
                      icon="new-session"
                      class="w-full"
                      onClick={() => {
                        const dir = worktree()
                        if (!dir) return
                        navigateWithSidebarReset(`/${base64Encode(dir)}/session`)
                      }}
                    >
                      {language.t("command.session.new")}
                    </Button>
                  </div>
                  <div class="flex-1 min-h-0">
                    <LocalWorkspace
                      ctx={workspaceSidebarCtx}
                      project={project()!}
                      sortNow={sortNow}
                      mobile={panelProps.mobile}
                      popover={popover()}
                    />
                  </div>
                </>
              }
            >
              <>
                <div class="shrink-0 py-4">
                  <Button
                    size="large"
                    icon="plus-small"
                    class="w-full"
                    onClick={() => {
                      const item = project()
                      if (!item) return
                      createWorkspace(item)
                    }}
                  >
                    {language.t("workspace.new")}
                  </Button>
                </div>
                <div class="relative flex-1 min-h-0">
                  <DragDropProvider
                    onDragStart={handleWorkspaceDragStart}
                    onDragEnd={handleWorkspaceDragEnd}
                    onDragOver={handleWorkspaceDragOver}
                    collisionDetector={closestCenter}
                  >
                    <DragDropSensors />
                    <ConstrainDragXAxis />
                    <div
                      ref={(el) => setScrollContainerRef(el, !!panelProps.mobile)}
                      class="size-full flex flex-col py-2 gap-4 overflow-y-auto no-scrollbar [overflow-anchor:none]"
                    >
                      <SortableProvider ids={workspaces()}>
                        <For each={workspaces()}>
                          {(directory) => (
                            <SortableWorkspace
                              ctx={workspaceSidebarCtx}
                              directory={directory}
                              project={project()!}
                              sortNow={sortNow}
                              mobile={panelProps.mobile}
                              popover={popover()}
                            />
                          )}
                        </For>
                      </SortableProvider>
                    </div>
                    <DragOverlay>
                      <WorkspaceDragOverlay
                        sidebarProject={sidebarProject}
                        activeWorkspace={activeWorkspace}
                        workspaceLabel={workspaceLabel}
                      />
                    </DragOverlay>
                  </DragDropProvider>
                </div>
              </>
            </Show>
          </div>
        </>
      </Show>

      <div
        class="shrink-0 px-3 py-3"
        classList={{
          hidden: gettingStartedDismissed() || !(providers.all().length > 0 && providers.connected().length === 0),
        }}
      >
        <div class="rounded-xl bg-background-base shadow-xs-border-base" data-component="getting-started">
          <div class="p-3 flex flex-col gap-6">
            <div class="flex flex-col gap-2">
              <div class="text-14-medium text-text-strong">{language.t("sidebar.gettingStarted.title")}</div>
              <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                {language.t("sidebar.gettingStarted.line1")}
              </div>
              <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                {language.t("sidebar.gettingStarted.line2")}
              </div>
            </div>
            <div data-component="getting-started-actions">
              <Button size="large" icon="arrow-right" onClick={() => window.open("https://ollama.com", "_blank")}>
                Install Ollama
              </Button>
              <Button size="large" variant="ghost" icon="plus-small" onClick={connectProvider}>
                {language.t("command.provider.connect")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
