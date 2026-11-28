; Experimental local proof packaging only. No remote endpoint, autostart or PC grant.
#ifndef PayloadDir
  #error PayloadDir must identify the reviewed staged binaries
#endif
[Setup]
AppId=ComputerLinkLocalPreview
AppName=Computer-Link Local Preview
AppVersion=0.1.0
DefaultDirName={userdesktop}\Computer-Link-Local-Preview
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CreateUninstallRegKey=no
Uninstallable=yes
UsePreviousAppDir=no
UsePreviousTasks=no
UsePreviousLanguage=no
CloseApplications=no
RestartApplications=no
WizardStyle=modern
OutputBaseFilename=Computer-Link-Local-Preview-Setup
OutputDir=output
Compression=lzma2
SolidCompression=yes
InfoBeforeFile=SETUP-NOTICE.txt
[Files]
Source: "{#PayloadDir}\computer-link-owner-proof.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\local-client.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\computer-link-mcp-session.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "SETUP-NOTICE.txt"; DestDir: "{app}"; Flags: ignoreversion
[Run]
Filename: "{app}\computer-link-owner-proof.exe"; Description: "Open experimental local preview (does not connect ChatGPT)"; Flags: postinstall nowait skipifsilent unchecked
[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if DirExists(ExpandConstant('{app}')) or FileExists(ExpandConstant('{app}')) then
    Result := 'Choose a new destination folder. Existing folders are refused to protect their contents. No upgrade or overwrite is performed.';
end;
