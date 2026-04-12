import { createEffect, onCleanup, onMount } from "solid-js"
import { base64Encode } from "@librecode/util/encode"
import { getFilename } from "@librecode/util/path"
import { showToast, toaster } from "@librecode/ui/toast"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { playSound, soundSrc } from "@/utils/sound"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { usePlatform } from "@/context/platform"
import type { useSettings } from "@/context/settings"
import type { useLanguage } from "@/context/language"
import type { usePermission } from "@/context/permission"

type GlobalSDK = ReturnType<typeof useGlobalSDK>
type GlobalSync = ReturnType<typeof useGlobalSync>
type Platform = ReturnType<typeof usePlatform>
type Settings = ReturnType<typeof useSettings>
type Language = ReturnType<typeof useLanguage>
type Permission = ReturnType<typeof usePermission>

export type NotificationDeps = {
  params: { id?: string }
  currentDir: () => string
  globalSDK: GlobalSDK
  globalSync: GlobalSync
  platform: Platform
  settings: Settings
  language: Language
  permission: Permission
  navigate: (href: string) => void
  setBusy: (directory: string, value: boolean) => void
}

export function useUpdatePolling(deps: NotificationDeps): void {
  const { platform, settings, language } = deps

  onMount(() => {
    if (!platform.checkUpdate || !platform.update || !platform.restart) return

    let toastId: number | undefined
    let interval: ReturnType<typeof setInterval> | undefined

    const pollUpdate = () =>
      platform.checkUpdate!().then(({ updateAvailable, version }) => {
        if (!updateAvailable) return
        if (toastId !== undefined) return
        toastId = showToast({
          persistent: true,
          icon: "download",
          title: language.t("toast.update.title"),
          description: language.t("toast.update.description", { version: version ?? "" }),
          actions: [
            {
              label: language.t("toast.update.action.installRestart"),
              onClick: async () => {
                await platform.update!()
                await platform.restart!()
              },
            },
            {
              label: language.t("toast.update.action.notYet"),
              onClick: "dismiss",
            },
          ],
        })
      })

    createEffect(() => {
      if (!settings.ready()) return

      if (!settings.updates.startup()) {
        if (interval === undefined) return
        clearInterval(interval)
        interval = undefined
        return
      }

      if (interval !== undefined) return
      void pollUpdate()
      interval = setInterval(pollUpdate, 10 * 60 * 1000)
    })

    onCleanup(() => {
      if (interval === undefined) return
      clearInterval(interval)
    })
  })
}

export function useSDKNotificationToasts(deps: NotificationDeps): void {
  const { params, currentDir, globalSDK, globalSync, platform, settings, language, permission, navigate, setBusy } =
    deps

  onMount(() => {
    const toastBySession = new Map<string, number>()
    const alertedAtBySession = new Map<string, number>()
    const cooldownMs = 5000

    const dismissSessionAlert = (sessionKey: string) => {
      const toastId = toastBySession.get(sessionKey)
      if (toastId === undefined) return
      toaster.dismiss(toastId)
      toastBySession.delete(sessionKey)
      alertedAtBySession.delete(sessionKey)
    }

    const unsub = globalSDK.event.listen((e) => {
      if (e.details?.type === "worktree.ready") {
        setBusy(e.name, false)
        WorktreeState.ready(e.name)
        return
      }

      if (e.details?.type === "worktree.failed") {
        setBusy(e.name, false)
        WorktreeState.failed(e.name, e.details.properties?.message ?? language.t("common.requestFailed"))
        return
      }

      if (
        e.details?.type === "question.replied" ||
        e.details?.type === "question.rejected" ||
        e.details?.type === "permission.replied"
      ) {
        const props = e.details.properties as { sessionID: string }
        const sessionKey = `${e.name}:${props.sessionID}`
        dismissSessionAlert(sessionKey)
        return
      }

      if (e.details?.type !== "permission.asked" && e.details?.type !== "question.asked") return

      const title =
        e.details.type === "permission.asked"
          ? language.t("notification.permission.title")
          : language.t("notification.question.title")
      const icon = e.details.type === "permission.asked" ? ("checklist" as const) : ("bubble-5" as const)
      const directory = e.name
      const props = e.details.properties
      if (e.details.type === "permission.asked" && permission.autoResponds(e.details.properties, directory)) return

      const [store] = globalSync.child(directory, { bootstrap: false })
      const session = store.session.find((s) => s.id === props.sessionID)
      const sessionKey = `${directory}:${props.sessionID}`

      const sessionTitle = session?.title ?? language.t("command.session.new")
      const projectName = getFilename(directory)
      const description =
        e.details.type === "permission.asked"
          ? language.t("notification.permission.description", { sessionTitle, projectName })
          : language.t("notification.question.description", { sessionTitle, projectName })
      const href = `/${base64Encode(directory)}/session/${props.sessionID}`

      const now = Date.now()
      const lastAlerted = alertedAtBySession.get(sessionKey) ?? 0
      if (now - lastAlerted < cooldownMs) return
      alertedAtBySession.set(sessionKey, now)

      if (e.details.type === "permission.asked") {
        if (settings.sounds.permissionsEnabled()) {
          playSound(soundSrc(settings.sounds.permissions()))
        }
        if (settings.notifications.permissions()) {
          void platform.notify(title, description, href)
        }
      }

      if (e.details.type === "question.asked") {
        if (settings.notifications.agent()) {
          void platform.notify(title, description, href)
        }
      }

      const currentSession = params.id
      if (directory === currentDir() && props.sessionID === currentSession) return
      if (directory === currentDir() && session?.parentID === currentSession) return

      dismissSessionAlert(sessionKey)

      const toastId = showToast({
        persistent: true,
        icon,
        title,
        description,
        actions: [
          {
            label: language.t("notification.action.goToSession"),
            onClick: () => navigate(href),
          },
          {
            label: language.t("common.dismiss"),
            onClick: "dismiss",
          },
        ],
      })
      toastBySession.set(sessionKey, toastId)
    })
    onCleanup(unsub)

    createEffect(() => {
      const currentSession = params.id
      if (!currentDir() || !currentSession) return
      const sessionKey = `${currentDir()}:${currentSession}`
      dismissSessionAlert(sessionKey)
      const [store] = globalSync.child(currentDir(), { bootstrap: false })
      const childSessions = store.session.filter((s) => s.parentID === currentSession)
      for (const child of childSessions) {
        dismissSessionAlert(`${currentDir()}:${child.id}`)
      }
    })
  })
}
