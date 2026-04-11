/**
 * Shared prop types for message-part components.
 */
import type { Message as MessageType, Part as PartType } from "@librecode/sdk/v2"

export interface MessagePartProps {
  part: PartType
  message: MessageType
  hideDetails?: boolean
  defaultOpen?: boolean
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
}
