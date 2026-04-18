import { createEffect, createSignal, onCleanup } from "solid-js"

export type VoiceInputState = "inactive" | "listening" | "error"

/**
 * Reactive voice input primitive using the Web Speech API.
 *
 * Provides:
 * - `state` signal: "inactive" | "listening" | "error"
 * - `transcript` signal: current interim text being spoken
 * - `toggle()`: start/stop listening
 * - `onResult` callback: fired with each final transcript segment
 *
 * Automatically restarts recognition after silence (Web Speech API
 * stops after ~5s of silence in continuous mode). Supports a trigger
 * word that calls `onTrigger` when detected at the end of speech.
 */
export function createVoiceInput(options: {
  language?: string
  triggerWord?: () => string
  onResult: (text: string) => void
  onTrigger?: () => void
}) {
  const [state, setState] = createSignal<VoiceInputState>("inactive")
  const [transcript, setTranscript] = createSignal("")
  const [errorMessage, setErrorMessage] = createSignal("")

  let recognition: SpeechRecognition | undefined
  let shouldRestart = false

  function isSupported(): boolean {
    return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  }

  function createRecognition(): SpeechRecognition | undefined {
    if (!isSupported()) return undefined
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) return undefined
    const r = new SR()
    r.continuous = true
    r.interimResults = true
    r.lang = options.language ?? navigator.language
    return r
  }

  function start() {
    if (state() === "listening") return
    recognition = createRecognition()
    if (!recognition) {
      setState("error")
      setErrorMessage("Speech recognition not supported in this browser")
      return
    }

    shouldRestart = true

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          const text = result[0].transcript.trim()
          if (text) {
            options.onResult(text)
            checkTrigger(text)
          }
        } else {
          interim += result[0].transcript
        }
      }
      setTranscript(interim)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") return
      setState("error")
      setErrorMessage(event.error)
      shouldRestart = false
    }

    recognition.onend = () => {
      setTranscript("")
      if (shouldRestart && state() === "listening") {
        // Auto-restart after silence timeout
        try {
          recognition?.start()
        } catch {
          setState("inactive")
        }
      } else {
        setState("inactive")
      }
    }

    try {
      recognition.start()
      setState("listening")
      setErrorMessage("")
    } catch {
      setState("error")
      setErrorMessage("Failed to start speech recognition")
    }
  }

  function stop() {
    shouldRestart = false
    recognition?.stop()
    setState("inactive")
    setTranscript("")
  }

  function toggle() {
    if (state() === "listening") {
      stop()
    } else {
      start()
    }
  }

  function checkTrigger(text: string) {
    const trigger = options.triggerWord?.()
    if (!trigger || !options.onTrigger) return
    if (text.toLowerCase().endsWith(trigger.toLowerCase())) {
      options.onTrigger()
    }
  }

  onCleanup(stop)

  return {
    state,
    transcript,
    errorMessage,
    toggle,
    isSupported: isSupported(),
  } as const
}

// Web Speech API type declarations (not in all TS libs)
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: { readonly transcript: string; readonly confidence: number }
}
interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognition
}
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}
