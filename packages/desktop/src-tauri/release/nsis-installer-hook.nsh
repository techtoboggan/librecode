; NSIS installer hook for librecode-desktop.
;
; Tauri's NSIS bundler installs LibreCode.exe + the bundled CLI sidecar
; (librecode-cli.exe) to $INSTDIR. This hook:
;
;   1. Copies librecode-cli.exe → librecode.exe so users can run
;      `librecode` from a terminal (matching the Unix command name).
;   2. Adds $INSTDIR to the user's PATH (HKCU\Environment\Path) so the
;      command is findable without a terminal restart + shell-rc edit.
;   3. On uninstall, removes the PATH entry and the copied exe.
;
; Tauri wires this file via bundle.windows.nsis.installerHooks. See
; tauri.prod.conf.json and tauri.beta.conf.json.

!include "EnvVarUpdate.nsh"  ; provided by Tauri's NSIS bundle

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "LibreCode: installing CLI wrapper + adding to PATH"

  ; Copy the sidecar so users can run `librecode` (not `librecode-cli`)
  IfFileExists "$INSTDIR\librecode-cli.exe" 0 +3
    CopyFiles /SILENT "$INSTDIR\librecode-cli.exe" "$INSTDIR\librecode.exe"

  ; Add install dir to user PATH if not already present.
  ; HKCU is user-scoped — no admin required.
  ${EnvVarUpdate} $0 "PATH" "A" "HKCU" "$INSTDIR"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "LibreCode: removing from PATH + cleaning up CLI wrapper"

  ${un.EnvVarUpdate} $0 "PATH" "R" "HKCU" "$INSTDIR"

  IfFileExists "$INSTDIR\librecode.exe" 0 +2
    Delete "$INSTDIR\librecode.exe"
!macroend
