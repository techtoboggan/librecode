import { For, Match, Show, Switch, type JSX } from "solid-js"
import { Tabs } from "@librecode/ui/tabs"
import { ResizeHandle } from "@librecode/ui/resize-handle"
import FileTree from "@/components/file-tree"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import type { Sizing } from "@/pages/session/helpers"

/**
 * Right-side panel of the session view: switches between "changes"
 * (review-scoped file list) and "all" (full project tree) with a
 * shared resize handle.
 *
 * Extracted from `session-side-panel.tsx` in Phase 48 to bring that
 * file under the 500-line budget. All state still flows in from the
 * parent — this component is purely presentational.
 *
 * No reactive resource fetches: file-tree state flows from `useFile()` /
 * `useLayout()` mount-time contexts. ADR-006 lint annotation not required.
 */
export interface SessionFileTreePanelProps {
  fileOpen: () => boolean
  reviewOpen: () => boolean
  treeWidth: () => string
  reviewCount: () => number
  hasReview: () => boolean
  diffsReady: () => boolean
  diffFiles: () => string[]
  kinds: () => Map<string, "add" | "del" | "mix">
  nofiles: () => boolean
  reviewEmptyKey: () => string
  activeDiff: string | undefined
  focusReviewDiff: (path: string) => void
  onFileClick: (path: string) => void
  size: Sizing
}

export function SessionFileTreePanel(props: SessionFileTreePanelProps): JSX.Element {
  const layout = useLayout()
  const language = useLanguage()
  const sync = useSync()

  const fileTreeTab = (): string => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string): void => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const empty = (msg: string): JSX.Element => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  return (
    <div
      id="file-tree-panel"
      aria-hidden={!props.fileOpen()}
      inert={!props.fileOpen()}
      class="relative min-w-0 h-full shrink-0 overflow-hidden"
      classList={{
        "pointer-events-none": !props.fileOpen(),
        "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
          !props.size.active(),
      }}
      style={{ width: props.treeWidth() }}
    >
      <div
        class="h-full flex flex-col overflow-hidden group/filetree"
        classList={{ "border-l border-border-weaker-base": props.reviewOpen() }}
      >
        <Tabs variant="pill" value={fileTreeTab()} onChange={setFileTreeTabValue} class="h-full" data-scope="filetree">
          <Tabs.List>
            <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
              {props.reviewCount()}{" "}
              {language.t(props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
            </Tabs.Trigger>
            <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
              {language.t("session.files.all")}
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
            <Switch>
              <Match when={props.hasReview()}>
                <Show
                  when={props.diffsReady()}
                  fallback={
                    <div class="px-2 py-2 text-12-regular text-text-weak">
                      {language.t("common.loading")}
                      {language.t("common.loading.ellipsis")}
                    </div>
                  }
                >
                  <FileTree
                    path=""
                    class="pt-3"
                    allowed={props.diffFiles()}
                    kinds={props.kinds()}
                    draggable={false}
                    active={props.activeDiff}
                    onFileClick={(node) => props.focusReviewDiff(node.path)}
                  />
                </Show>
              </Match>
              <Match when={true}>
                {empty(
                  language.t(sync.project && !sync.project.vcs ? "session.review.noChanges" : props.reviewEmptyKey()),
                )}
              </Match>
            </Switch>
          </Tabs.Content>
          <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
            <Switch>
              <Match when={props.nofiles()}>{empty(language.t("session.files.empty"))}</Match>
              <Match when={true}>
                <FileTree
                  path=""
                  class="pt-3"
                  modified={props.diffFiles()}
                  kinds={props.kinds()}
                  onFileClick={(node) => props.onFileClick(node.path)}
                />
              </Match>
            </Switch>
          </Tabs.Content>
        </Tabs>
      </div>
      <Show when={props.fileOpen()}>
        <div onPointerDown={() => props.size.start()}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={layout.fileTree.width()}
            min={200}
            max={480}
            collapseThreshold={160}
            onResize={(width) => {
              props.size.touch()
              layout.fileTree.resize(width)
            }}
            onCollapse={layout.fileTree.close}
          />
        </div>
      </Show>
    </div>
  )
}
