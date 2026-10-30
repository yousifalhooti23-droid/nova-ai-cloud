; NOVA AI Cloud — NSIS installer hooks
; ====================================
; Guarantees the shortcuts the product promises and a clean uninstall,
; on top of whatever Tauri's own NSIS template creates.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "NOVA: creating desktop and Start Menu shortcuts"
  ; Desktop shortcut
  CreateShortCut "$DESKTOP\NOVA AI Cloud.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  ; Start Menu folder + entries
  CreateDirectory "$SMPROGRAMS\NOVA AI Cloud"
  CreateShortCut "$SMPROGRAMS\NOVA AI Cloud\NOVA AI Cloud.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  CreateShortCut "$SMPROGRAMS\NOVA AI Cloud\Uninstall NOVA AI Cloud.lnk" "$INSTDIR\uninstall.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "NOVA: stopping the sidecar server"
  ; The sidecar is a separate process; make sure it is not holding files open.
  nsExec::ExecToLog 'taskkill /IM nova-server.exe /F'
  Sleep 500

  DetailPrint "NOVA: removing shortcuts"
  Delete "$DESKTOP\NOVA AI Cloud.lnk"
  Delete "$SMPROGRAMS\NOVA AI Cloud\NOVA AI Cloud.lnk"
  Delete "$SMPROGRAMS\NOVA AI Cloud\Uninstall NOVA AI Cloud.lnk"
  RMDir "$SMPROGRAMS\NOVA AI Cloud"
!macroend
