; Builds RemotePc-Setup.exe with Inno Setup (free). The GitHub workflow "release" does this for you.
; The .exe carries only install.ps1; it runs it, and install.ps1 downloads the newest app from GitHub,
; so one Setup.exe never goes out of date.

#define AppName "RemotePc"
#define AppVersion GetEnv("RSP_VERSION")
#if AppVersion == ""
  #define AppVersion "0.0.0"
#endif

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Aswin K Santhosh
DefaultDirName={tmp}\RemotePcSetup
CreateAppDir=no
Uninstallable=no
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
PrivilegesRequired=admin
OutputDir=..\dist
OutputBaseFilename=RemotePc-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
LicenseFile=..\LICENSE

[Files]
Source: "..\install.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\install.ps1"""; StatusMsg: "Installing RemotePc (a black window opens: follow it)..."; Flags: waituntilterminated
