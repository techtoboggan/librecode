/**
 * Per-shell command invocation strategies.
 *
 * Maps shell names to their argument arrays for executing user commands.
 * Each entry handles shell-specific initialization (sourcing rc files, etc.)
 */

export function getShellArgs(shellName: string, command: string): string[] {
  switch (shellName) {
    case "nu":
    case "fish":
      return ["-c", command]

    case "zsh":
      return [
        "-c",
        "-l",
        `
          [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
          [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
          eval ${JSON.stringify(command)}
        `,
      ]

    case "bash":
      return [
        "-c",
        "-l",
        `
          shopt -s expand_aliases
          [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
          eval ${JSON.stringify(command)}
        `,
      ]

    case "cmd":
      return ["/c", command]

    case "powershell":
    case "pwsh":
      return ["-NoProfile", "-Command", command]

    default:
      return ["-c", command]
  }
}
