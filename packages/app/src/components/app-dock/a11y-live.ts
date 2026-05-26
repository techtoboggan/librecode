import { createSignal, type Accessor } from "solid-js"

/**
 * Polite live-region announcer for dock lifecycle events.
 *
 * Returns a writable accessor + a signal of the current message.
 * The dock root renders a single hidden `<div aria-live="polite"
 * aria-atomic="true">` reading from this signal. Each new message
 * replaces the previous one; screen readers announce only the
 * latest.
 *
 * Phase 50.
 */
export function createLiveAnnouncer(): {
  announce: (msg: string) => void
  message: Accessor<string>
} {
  const [message, setMessage] = createSignal("")
  let timeout: ReturnType<typeof setTimeout> | undefined

  return {
    announce: (msg: string) => {
      // Brief clear-then-set cycle so the same message announced
      // twice in a row still fires (screen readers ignore unchanged
      // live-region content).
      setMessage("")
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => setMessage(msg), 16)
    },
    message,
  }
}
