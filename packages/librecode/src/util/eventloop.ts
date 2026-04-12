import { Log } from "./log"

type NodeProcessInternal = NodeJS.Process & {
  _getActiveHandles(): unknown[]
  _getActiveRequests(): unknown[]
}

async function eventLoopWait() {
  return new Promise<void>((resolve) => {
    const proc = process as NodeProcessInternal
    const check = () => {
      const active = [...proc._getActiveHandles(), ...proc._getActiveRequests()]
      Log.Default.info("eventloop", {
        active,
      })
      if (proc._getActiveHandles().length === 0 && proc._getActiveRequests().length === 0) {
        resolve()
      } else {
        setImmediate(check)
      }
    }
    check()
  })
}

export const EventLoop = {
  wait: eventLoopWait,
} as const
