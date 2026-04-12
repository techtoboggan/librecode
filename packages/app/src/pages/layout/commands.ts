import { showToast } from "@librecode/ui/toast"
import type { useCommand, CommandOption } from "@/context/command"
import type { useTheme, ColorScheme } from "@librecode/ui/theme"
import type { useLanguage, Locale } from "@/context/language"
import type { useLayout } from "@/context/layout"
import type { Session } from "@librecode/sdk/v2/client"

type Command = ReturnType<typeof useCommand>
type Theme = ReturnType<typeof useTheme>
type Language = ReturnType<typeof useLanguage>
type Layout = ReturnType<typeof useLayout>

export type CommandsDeps = {
  params: { dir?: string; id?: string }
  command: Command
  theme: Theme
  language: Language
  layout: Layout
  colorSchemeOrder: ColorScheme[]
  colorSchemeLabel: (scheme: ColorScheme) => string
  availableThemeEntries: () => [string, { name?: string }][]
  currentSessions: () => Session[]
  currentProject: () => { worktree: string; vcs?: "git" } | undefined
  workspaceSetting: () => boolean
  navigateSessionByOffset: (offset: number) => void
  navigateSessionByUnseen: (offset: number) => void
  archiveSession: (session: Session) => Promise<void>
  createWorkspace: (project: { worktree: string; vcs?: "git" }) => Promise<void>
  chooseProject: () => Promise<void>
  connectProvider: () => void
  openServer: () => void
  openSettings: () => void
}

export function cycleTheme(
  deps: Pick<CommandsDeps, "theme" | "language" | "availableThemeEntries">,
  direction = 1,
): void {
  const { theme, language, availableThemeEntries } = deps
  const ids = availableThemeEntries().map(([id]) => id)
  if (ids.length === 0) return
  const currentIndex = ids.indexOf(theme.themeId())
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + ids.length) % ids.length
  const nextThemeId = ids[nextIndex]
  theme.setTheme(nextThemeId)
  const nextTheme = theme.themes()[nextThemeId]
  showToast({
    title: language.t("toast.theme.title"),
    description: nextTheme?.name ?? nextThemeId,
  })
}

export function cycleColorScheme(
  deps: Pick<CommandsDeps, "theme" | "language" | "colorSchemeOrder" | "colorSchemeLabel">,
  direction = 1,
): void {
  const { theme, language, colorSchemeOrder, colorSchemeLabel } = deps
  const current = theme.colorScheme()
  const currentIndex = colorSchemeOrder.indexOf(current)
  const nextIndex =
    currentIndex === -1 ? 0 : (currentIndex + direction + colorSchemeOrder.length) % colorSchemeOrder.length
  const next = colorSchemeOrder[nextIndex]
  theme.setColorScheme(next)
  showToast({
    title: language.t("toast.scheme.title"),
    description: colorSchemeLabel(next),
  })
}

export function setLocale(deps: Pick<CommandsDeps, "language">, next: Locale): void {
  const { language } = deps
  if (next === language.locale()) return
  language.setLocale(next)
  showToast({
    title: language.t("toast.language.title"),
    description: language.t("toast.language.description", { language: language.label(next) }),
  })
}

export function cycleLanguage(deps: Pick<CommandsDeps, "language">, direction = 1): void {
  const { language } = deps
  const locales = language.locales
  const currentIndex = locales.indexOf(language.locale())
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + locales.length) % locales.length
  const next = locales[nextIndex]
  if (!next) return
  setLocale(deps, next)
}

export function registerLayoutCommands(deps: CommandsDeps): void {
  const {
    params,
    command,
    theme,
    language,
    layout,
    colorSchemeOrder,
    colorSchemeLabel,
    availableThemeEntries,
    currentSessions,
    currentProject,
    workspaceSetting,
    navigateSessionByOffset,
    navigateSessionByUnseen,
    archiveSession,
    createWorkspace,
    chooseProject,
    connectProvider,
    openServer,
    openSettings,
  } = deps

  command.register("layout", () => {
    const commands: CommandOption[] = [
      {
        id: "sidebar.toggle",
        title: language.t("command.sidebar.toggle"),
        category: language.t("command.category.view"),
        keybind: "mod+b",
        onSelect: () => layout.sidebar.toggle(),
      },
      {
        id: "project.open",
        title: language.t("command.project.open"),
        category: language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: () => chooseProject(),
      },
      {
        id: "provider.connect",
        title: language.t("command.provider.connect"),
        category: language.t("command.category.provider"),
        onSelect: () => connectProvider(),
      },
      {
        id: "server.switch",
        title: language.t("command.server.switch"),
        category: language.t("command.category.server"),
        onSelect: () => openServer(),
      },
      {
        id: "settings.open",
        title: language.t("command.settings.open"),
        category: language.t("command.category.settings"),
        keybind: "mod+comma",
        onSelect: () => openSettings(),
      },
      {
        id: "session.previous",
        title: language.t("command.session.previous"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => navigateSessionByOffset(-1),
      },
      {
        id: "session.next",
        title: language.t("command.session.next"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => navigateSessionByOffset(1),
      },
      {
        id: "session.previous.unseen",
        title: language.t("command.session.previous.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowup",
        onSelect: () => navigateSessionByUnseen(-1),
      },
      {
        id: "session.next.unseen",
        title: language.t("command.session.next.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowdown",
        onSelect: () => navigateSessionByUnseen(1),
      },
      {
        id: "session.archive",
        title: language.t("command.session.archive"),
        category: language.t("command.category.session"),
        keybind: "mod+shift+backspace",
        disabled: !params.dir || !params.id,
        onSelect: () => {
          const session = currentSessions().find((s) => s.id === params.id)
          if (session) archiveSession(session)
        },
      },
      {
        id: "workspace.new",
        title: language.t("workspace.new"),
        category: language.t("command.category.workspace"),
        keybind: "mod+shift+w",
        disabled: !workspaceSetting(),
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          return createWorkspace(project)
        },
      },
      {
        id: "workspace.toggle",
        title: language.t("command.workspace.toggle"),
        description: language.t("command.workspace.toggle.description"),
        category: language.t("command.category.workspace"),
        slash: "workspace",
        disabled: !currentProject() || currentProject()?.vcs !== "git",
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          if (project.vcs !== "git") return
          const wasEnabled = layout.sidebar.workspaces(project.worktree)()
          layout.sidebar.toggleWorkspaces(project.worktree)
          showToast({
            title: wasEnabled
              ? language.t("toast.workspace.disabled.title")
              : language.t("toast.workspace.enabled.title"),
            description: wasEnabled
              ? language.t("toast.workspace.disabled.description")
              : language.t("toast.workspace.enabled.description"),
          })
        },
      },
      {
        id: "theme.cycle",
        title: language.t("command.theme.cycle"),
        category: language.t("command.category.theme"),
        keybind: "mod+shift+t",
        onSelect: () => cycleTheme(deps, 1),
      },
    ]

    for (const [id, definition] of availableThemeEntries()) {
      commands.push({
        id: `theme.set.${id}`,
        title: language.t("command.theme.set", { theme: definition.name ?? id }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewTheme(id)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "theme.scheme.cycle",
      title: language.t("command.theme.scheme.cycle"),
      category: language.t("command.category.theme"),
      keybind: "mod+shift+s",
      onSelect: () => cycleColorScheme(deps, 1),
    })

    for (const scheme of colorSchemeOrder) {
      commands.push({
        id: `theme.scheme.${scheme}`,
        title: language.t("command.theme.scheme.set", { scheme: colorSchemeLabel(scheme) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewColorScheme(scheme)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "language.cycle",
      title: language.t("command.language.cycle"),
      category: language.t("command.category.language"),
      onSelect: () => cycleLanguage(deps, 1),
    })

    for (const locale of language.locales) {
      commands.push({
        id: `language.set.${locale}`,
        title: language.t("command.language.set", { language: language.label(locale) }),
        category: language.t("command.category.language"),
        onSelect: () => setLocale(deps, locale),
      })
    }

    return commands
  })
}
