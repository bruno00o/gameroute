; GameRoute NSIS Installer Hooks
; Handles installation and removal of the GameRouteCaptureService

!macro NSIS_HOOK_POSTINSTALL
  ; Install and start the capture service
  DetailPrint "Installing GameRoute Capture Service..."

  ; First, stop and delete any existing service (ignore errors)
  nsExec::ExecToLog 'sc stop GameRouteCaptureService'
  nsExec::ExecToLog 'sc delete GameRouteCaptureService'

  ; Wait for service to be fully stopped/deleted
  Sleep 1000

  ; Create the new service
  nsExec::ExecToLog 'sc create GameRouteCaptureService binPath= "$INSTDIR\gameroute-capture-service.exe" start= auto DisplayName= "GameRoute Capture Service"'

  ; Set service description
  nsExec::ExecToLog 'sc description GameRouteCaptureService "Captures UDP network traffic for game connection analysis in GameRoute."'

  nsExec::ExecToLog 'sc failure GameRouteCaptureService reset= 86400 actions= restart/5000/restart/5000/restart/60000'

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GameRoute traceroute ICMP"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="GameRoute traceroute ICMP" dir=in action=allow protocol=icmpv4:11,any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="GameRoute traceroute ICMP" dir=in action=allow protocol=icmpv4:3,any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="GameRoute traceroute ICMP" dir=in action=allow protocol=icmpv4:0,any'

  ; Start the service
  nsExec::ExecToLog 'sc start GameRouteCaptureService'

  DetailPrint "GameRoute Capture Service installation complete."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Stop and remove the capture service before uninstalling
  DetailPrint "Removing GameRoute Capture Service..."

  ; Stop the service
  nsExec::ExecToLog 'sc stop GameRouteCaptureService'

  ; Wait for service to stop
  Sleep 2000

  ; Delete the service
  nsExec::ExecToLog 'sc delete GameRouteCaptureService'

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GameRoute traceroute ICMP"'

  DetailPrint "GameRoute Capture Service removal complete."
!macroend
