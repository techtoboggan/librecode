import { EventEmitter } from "node:events"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      // biome-ignore lint/suspicious/noExplicitAny: EventEmitter payload must be any for listener covariance
      payload: any
    },
  ]
}>()
