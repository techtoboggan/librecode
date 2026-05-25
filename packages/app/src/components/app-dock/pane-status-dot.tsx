import { type JSX } from "solid-js"
import { statusDotClass, type PaneStatus } from "./pane-status"

export interface PaneStatusDotProps {
  status: PaneStatus
}

export function PaneStatusDot(props: PaneStatusDotProps): JSX.Element {
  const tooltip = () => props.status.label
  return (
    <span
      data-testid={`pane-status-${props.status.kind}`}
      class={`inline-block w-2 h-2 rounded-full shrink-0 ${statusDotClass(props.status.kind)}`}
      role="status"
      aria-label={props.status.label}
      title={tooltip()}
    />
  )
}
