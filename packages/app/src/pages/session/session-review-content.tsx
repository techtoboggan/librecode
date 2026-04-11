import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { Button } from "@librecode/ui/button"
import { Select } from "@librecode/ui/select"
import type { FileDiff } from "@librecode/sdk/v2"
import type { LineComment } from "@/context/comments"
import type { SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { type DiffStyle, SessionReviewTab, type SessionReviewTabProps } from "@/pages/session/review-tab"
import type { SessionReviewCommentActions, SessionReviewCommentDelete, SessionReviewCommentUpdate } from "@librecode/ui/session-review"

const changesOptionsList: ("session" | "turn")[] = ["session", "turn"]

export interface SessionReviewContentProps {
  hasReview: () => boolean
  changes: () => "session" | "turn"
  onChangesSelect: (value: "session" | "turn") => void
  diffsReady: () => boolean
  reviewEmptyKey: () => string
  gitLoading: () => boolean
  onInitGit: () => void
  deferRender: () => boolean
  reviewDiffs: () => FileDiff[]
  view: ReturnType<typeof useLayout>["view"]
  activeDiff: string | undefined
  diffStyle: () => DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
  onScrollRef: (el: HTMLDivElement) => void
  onLineComment: (comment: { file: string; selection: SelectedLineRange; comment: string; preview?: string }) => void
  onLineCommentUpdate: (comment: SessionReviewCommentUpdate) => void
  onLineCommentDelete: (comment: SessionReviewCommentDelete) => void
  lineCommentActions: () => SessionReviewCommentActions
  comments: () => LineComment[]
  focusedComment: () => { file: string; id: string } | null | undefined
  onFocusedCommentChange: (focus: { file: string; id: string } | null) => void
  onViewFile: (path: string) => void
}

export interface SessionReviewContentHelpers {
  reviewContent: (input: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => JSX.Element
  reviewPanel: () => JSX.Element
}

export function createReviewContentHelpers(props: SessionReviewContentProps): SessionReviewContentHelpers {
  const language = useLanguage()

  const changesTitle = () => {
    if (!props.hasReview()) return null

    return (
      <Select
        options={changesOptionsList}
        current={props.changes()}
        label={(option) =>
          option === "session" ? language.t("ui.sessionReview.title") : language.t("ui.sessionReview.title.lastTurn")
        }
        onSelect={(option) => option && props.onChangesSelect(option)}
        variant="ghost"
        size="small"
        valueClass="text-14-medium"
      />
    )
  }

  const emptyTurn = () => (
    <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
      <div class="text-14-regular text-text-weak max-w-56">{language.t("session.review.noChanges")}</div>
    </div>
  )

  const reviewEmpty = (input: { loadingClass: string; emptyClass: string }) => {
    if (props.changes() === "turn") return emptyTurn()

    if (props.hasReview() && !props.diffsReady()) {
      return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
    }

    if (props.reviewEmptyKey() === "session.review.noVcs") {
      return (
        <div class={input.emptyClass}>
          <div class="flex flex-col gap-3">
            <div class="text-14-medium text-text-strong">{language.t("session.review.noVcs.createGit.title")}</div>
            <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
              {language.t("session.review.noVcs.createGit.description")}
            </div>
          </div>
          <Button size="large" disabled={props.gitLoading()} onClick={props.onInitGit}>
            {props.gitLoading()
              ? language.t("session.review.noVcs.createGit.actionLoading")
              : language.t("session.review.noVcs.createGit.action")}
          </Button>
        </div>
      )
    }

    return (
      <div class={input.emptyClass}>
        <div class="text-14-regular text-text-weak max-w-56">{language.t(props.reviewEmptyKey())}</div>
      </div>
    )
  }

  const reviewContent = (input: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => (
    <Show when={!props.deferRender()}>
      <SessionReviewTab
        title={changesTitle()}
        empty={reviewEmpty(input)}
        diffs={props.reviewDiffs}
        view={props.view}
        diffStyle={input.diffStyle}
        onDiffStyleChange={input.onDiffStyleChange}
        onScrollRef={props.onScrollRef}
        focusedFile={props.activeDiff}
        onLineComment={props.onLineComment}
        onLineCommentUpdate={props.onLineCommentUpdate}
        onLineCommentDelete={props.onLineCommentDelete}
        lineCommentActions={props.lineCommentActions()}
        comments={props.comments()}
        focusedComment={props.focusedComment()}
        onFocusedCommentChange={props.onFocusedCommentChange}
        onViewFile={props.onViewFile}
        classes={input.classes}
      />
    </Show>
  )

  const reviewPanel = () => (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        {reviewContent({
          diffStyle: props.diffStyle(),
          onDiffStyleChange: props.onDiffStyleChange,
          loadingClass: "px-6 py-4 text-text-weak",
          emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
        })}
      </div>
    </div>
  )

  return { reviewContent, reviewPanel }
}
