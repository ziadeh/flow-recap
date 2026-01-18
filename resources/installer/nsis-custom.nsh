; =============================================================================
; FlowRecap NSIS Custom Installer Script
; =============================================================================
;
; This script extends the default electron-builder NSIS installer to:
; 1. Optionally install VB-Audio Virtual Cable for system audio capture
; 2. Provide custom installer pages
; 3. Handle virtual audio driver installation
;

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

; -----------------------------------------------------------------------------
; Variables
; -----------------------------------------------------------------------------
Var InstallVBCable
Var VBCableDriverPath

; -----------------------------------------------------------------------------
; Custom Page - Virtual Audio Driver
; -----------------------------------------------------------------------------
Function VirtualAudioPage
  ; Check if VB-Cable driver exists in the package
  StrCpy $VBCableDriverPath "$INSTDIR\drivers\windows\VBCable_Driver_Pack.exe"

  ${IfNot} ${FileExists} "$VBCableDriverPath"
    ; Driver not bundled, skip this page
    Abort
  ${EndIf}

  ; Check if VB-Cable is already installed
  ReadRegStr $0 HKLM "SOFTWARE\VB-Audio\Cable" "Version"
  ${If} $0 != ""
    ; Already installed, skip
    StrCpy $InstallVBCable "0"
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Virtual Audio Driver" "Install VB-Audio Virtual Cable for system audio capture"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ; Description label
  ${NSD_CreateLabel} 0 0 100% 40u "FlowRecap can capture system audio (e.g., from video calls) using a virtual audio driver.$\r$\n$\r$\nVB-Audio Virtual Cable is a free virtual audio driver that enables this feature."
  Pop $0

  ; Checkbox for installing VB-Cable
  ${NSD_CreateCheckbox} 0 50u 100% 12u "Install VB-Audio Virtual Cable (recommended)"
  Pop $InstallVBCable
  ${NSD_Check} $InstallVBCable

  ; Info label
  ${NSD_CreateLabel} 0 70u 100% 30u "Note: You can also install it later from https://vb-audio.com/Cable/$\r$\nThe driver installation requires administrator privileges."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function VirtualAudioPageLeave
  ${NSD_GetState} $InstallVBCable $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallVBCable "1"
  ${Else}
    StrCpy $InstallVBCable "0"
  ${EndIf}
FunctionEnd

; -----------------------------------------------------------------------------
; Custom Install Section - Virtual Audio Driver
; -----------------------------------------------------------------------------
Section "VB-Audio Virtual Cable" SecVBCable
  ; Only run if user selected to install
  ${If} $InstallVBCable != "1"
    Return
  ${EndIf}

  ; Check if driver file exists
  ${IfNot} ${FileExists} "$VBCableDriverPath"
    Return
  ${EndIf}

  DetailPrint "Installing VB-Audio Virtual Cable..."

  ; Run VB-Cable installer silently
  ; Note: VB-Cable installer requires admin rights
  nsExec::ExecToLog '"$VBCableDriverPath" /S'
  Pop $0

  ${If} $0 == 0
    DetailPrint "VB-Audio Virtual Cable installed successfully!"
  ${Else}
    DetailPrint "VB-Audio Virtual Cable installation returned: $0"
    ; Don't fail the main installation
  ${EndIf}
SectionEnd

; -----------------------------------------------------------------------------
; Macro to insert custom pages
; Called by electron-builder
; -----------------------------------------------------------------------------
!macro customInstallMode
  ; Use per-user installation by default
  ; This sets the installation mode to current user only (no admin elevation required)
  ; See: https://www.electron.build/nsis.html
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customPageAfterChangeDir
  ; Insert virtual audio page after directory selection
  Page custom VirtualAudioPage VirtualAudioPageLeave
!macroend

; -----------------------------------------------------------------------------
; Post-Installation Actions
; -----------------------------------------------------------------------------
!macro customInstall
  ; Create audio settings file to indicate VB-Cable availability
  ${If} $InstallVBCable == "1"
    ; Write a flag file to indicate VB-Cable was installed with the app
    FileOpen $0 "$INSTDIR\resources\vbcable-installed.flag" w
    FileWrite $0 "installed"
    FileClose $0
  ${EndIf}

  ; Clean up driver files after installation (optional - saves disk space)
  ; RMDir /r "$INSTDIR\drivers"
!macroend

; -----------------------------------------------------------------------------
; Uninstallation
; -----------------------------------------------------------------------------
!macro customUnInstall
  ; Remove flag file
  Delete "$INSTDIR\resources\vbcable-installed.flag"

  ; Note: We don't uninstall VB-Cable as it might be used by other apps
  ; Users can uninstall it manually if needed
!macroend

; -----------------------------------------------------------------------------
; Additional Installer Customization
; -----------------------------------------------------------------------------
!macro customHeader
  ; Custom branding
  !define MUI_HEADERIMAGE
  ; !define MUI_HEADERIMAGE_BITMAP "resources\installer-header.bmp"
  ; !define MUI_HEADERIMAGE_RIGHT
!macroend

!macro customWelcomePage
  ; Welcome page customization
  !define MUI_WELCOMEPAGE_TITLE "Welcome to FlowRecap"
  !define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of FlowRecap.$\r$\n$\r$\nFlowRecap helps you record, transcribe, and organize your meeting notes with AI-powered features.$\r$\n$\r$\nClick Next to continue."
!macroend

!macro customFinishPage
  ; Finish page customization
  !define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !define MUI_FINISHPAGE_RUN_TEXT "Launch FlowRecap"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_LINK "Visit vb-audio.com for virtual audio driver"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://vb-audio.com/Cable/"
!macroend
