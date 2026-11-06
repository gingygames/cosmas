; Kosmas (formerly Kronikář) – Windows installer (Inno Setup 6). Built by installer/build.py, which passes AppVer.
; Per-user install: no administrator rights, nothing outside the user's profile.

#ifndef AppVer
  #define AppVer "1.0.0"
#endif

[Setup]
AppId={{71435C9E-FB7D-42CC-8F2D-74A5F81ABB76}
AppName=Kosmas
AppVersion={#AppVer}
AppVerName=Kosmas {#AppVer}
AppPublisher=gingygames
AppPublisherURL=https://github.com/gingygames/kronikar
; folder, file and data names stay "Kronikar" so updates over older installs keep working
DefaultDirName={localappdata}\Programs\Kronikar
DefaultGroupName=Kosmas
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\build
OutputBaseFilename=Kronikar-Setup-{#AppVer}
SetupIconFile=..\rpcatalog\assets\kronikar.ico
UninstallDisplayIcon={app}\Kronikar.exe
UninstallDisplayName=Kosmas
WizardStyle=modern
ShowLanguageDialog=auto
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=8
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "cs"; MessagesFile: "compiler:Languages\Czech.isl"

[CustomMessages]
en.DesktopIcon=Create a desktop shortcut
cs.DesktopIcon=Vytvořit zástupce na ploše
en.Shortcuts=Shortcuts:
cs.Shortcuts=Zástupci:
en.AppComment=Catalogue of game recordings
cs.AppComment=Katalog herních záznamů
en.LaunchApp=Start Kosmas
cs.LaunchApp=Spustit Kosmase
en.DeleteData=Also delete your catalogue (events, characters, transcripts, thumbnails and downloaded models)?
cs.DeleteData=Smazat i tvůj katalog (události, postavy, přepisy, náhledy a stažené modely)?
en.DataFolder=Folder:
cs.DataFolder=Složka:
en.DeleteDataNote=The videos themselves are not deleted. If you choose No, everything will be back after the next install.
cs.DeleteDataNote=Videa samotná se nesmažou. Když zvolíš Ne, při další instalaci bude vše zpět.

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; GroupDescription: "{cm:Shortcuts}"

[InstallDelete]
; an update replaces the program completely (user data live elsewhere: %LOCALAPPDATA%\Kronikar)
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\app"
; shortcuts from before the rename to Kosmas
Type: files; Name: "{autoprograms}\Kronikář.lnk"
Type: files; Name: "{autodesktop}\Kronikář.lnk"

[Files]
Source: "..\build\dist\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Kosmas"; Filename: "{app}\Kronikar.exe"; WorkingDir: "{app}"; AppUserModelID: "Gingygames.Kronikar"; Comment: "{cm:AppComment}"
Name: "{autodesktop}\Kosmas"; Filename: "{app}\Kronikar.exe"; WorkingDir: "{app}"; AppUserModelID: "Gingygames.Kronikar"; Tasks: desktopicon

[Run]
Filename: "{app}\Kronikar.exe"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; caches Python writes next to the code at run time
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\app"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\Kronikar');
    if (not UninstallSilent) and DirExists(DataDir) then
      if MsgBox(CustomMessage('DeleteData') + #13#10 + #13#10 +
                CustomMessage('DataFolder') + ' ' + DataDir + #13#10 + CustomMessage('DeleteDataNote'),
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
