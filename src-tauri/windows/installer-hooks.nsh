; Runs inside the Tauri NSIS installer (bundle.windows.nsis.installerHooks).

; The Electron builds installed into their own folder. The first Tauri install
; removes that copy so only one app (and one Start Menu entry) remains. The
; settings stay: both builds share the same data folder in %APPDATA%.
!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$LOCALAPPDATA\Programs\jira-auto-logger\Uninstall Jira Auto Logger.exe" 0 +2
    ExecWait '"$LOCALAPPDATA\Programs\jira-auto-logger\Uninstall Jira Auto Logger.exe" /S'
!macroend
