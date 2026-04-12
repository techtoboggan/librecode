import { debounce, type Scheduled } from "@solid-primitives/scheduled"
import { type Accessor, createSignal } from "solid-js"

export function createDebouncedSignal<T>(value: T, ms: number): [Accessor<T>, Scheduled<[value: T]>] {
  const [get, set] = createSignal(value)
  return [get, debounce((v: T) => set(() => v), ms)]
}
