import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { checksum } from "@librecode/util/encode"

type ReviewScrollInput = {
  sessionKey: () => string
  diffsReady: () => boolean
  setScroll: (key: string, pos: { x: number; y: number }) => void
}

export function createReviewScrollState(input: ReviewScrollInput) {
  const [tree, setTree] = createStore({
    reviewScroll: undefined as HTMLDivElement | undefined,
    pendingDiff: undefined as string | undefined,
    activeDiff: undefined as string | undefined,
  })

  createEffect(() => {
    input.sessionKey()
    setTree({
      reviewScroll: undefined,
      pendingDiff: undefined,
      activeDiff: undefined,
    })
  })

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return undefined
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string): number | undefined => {
    const root = tree.reviewScroll
    if (!root) return undefined

    const id = reviewDiffId(path)
    if (!id) return undefined

    const el = document.getElementById(id)
    if (!(el instanceof HTMLElement)) return undefined
    if (!root.contains(el)) return undefined

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top - b.top + root.scrollTop
  }

  const scrollToReviewDiff = (path: string): boolean => {
    const root = tree.reviewScroll
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    input.setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  // Drive the pendingDiff scroll loop reactively
  createEffect(() => {
    const pending = tree.pendingDiff
    if (!pending) return
    if (!tree.reviewScroll) return
    if (!input.diffsReady()) return

    const attempt = (count: number) => {
      if (tree.pendingDiff !== pending) return
      if (count > 60) {
        setTree("pendingDiff", undefined)
        return
      }

      const root = tree.reviewScroll
      if (!root) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (!scrollToReviewDiff(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      const top = reviewDiffTop(pending)
      if (top === undefined) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (Math.abs(root.scrollTop - top) <= 1) {
        setTree("pendingDiff", undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  return {
    tree,
    setTree,
    reviewDiffTop,
    scrollToReviewDiff,
  }
}
