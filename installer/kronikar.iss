; Cosmas (Czech: Kosmas; formerly Kronikář) – Windows installer (Inno Setup 6). Built by installer/build.py, which
; passes AppVer (and TestBuild for update tests). Per-user install: no administrator rights, nothing outside the profile.
; The displayed name follows the installer language: English "Cosmas", Czech "Kosmas" ({cm:AppName}).
;
; Silent update (what the app runs):  Cosmas-Setup-x.y.z.exe /SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS
;                                     /LANG=en|cs /DIR="<install folder>" /RELAUNCH
; /RELAUNCH starts the app again after a silent install.

#ifndef AppVer
  #define AppVer "1.2.0"
#endif
#ifndef AppNumVer
  #define AppNumVer AppVer
#endif
#ifdef TestBuild
  ; a separate test app: own AppId, own default folder, no shortcuts, never touches the real install or its data
  #define TheAppId "{{5B0F9C3E-7E1A-4C55-9C51-3D7C2A1E0B11}"
  #define DefDir "{localappdata}\Programs\KronikarTest"
  #define NameSuffix " TEST"
#else
  #define TheAppId "{{71435C9E-FB7D-42CC-8F2D-74A5F81ABB76}"
  #define DefDir "{localappdata}\Programs\Kronikar"
  #define NameSuffix ""
#endif

[Setup]
AppId={#TheAppId}
AppName={cm:AppName}{#NameSuffix}
AppVersion={#AppVer}
AppVerName={cm:AppName}{#NameSuffix} {#AppVer}
AppPublisher=gingygames
AppPublisherURL=https://cosmas.gingygames.com
AppSupportURL=https://github.com/gingygames/cosmas/issues
AppUpdatesURL=https://github.com/gingygames/cosmas/releases/latest
VersionInfoVersion={#AppNumVer}
VersionInfoProductName=Cosmas
; folder, file and data names stay "Kronikar" so updates over older installs keep working
DefaultDirName={#DefDir}
DefaultGroupName={cm:AppName}{#NameSuffix}
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\build
#ifdef TestBuild
OutputBaseFilename=Cosmas-Setup-{#AppVer}-test
#else
OutputBaseFilename=Cosmas-Setup-{#AppVer}
#endif
SetupIconFile=..\rpcatalog\assets\kronikar.ico
UninstallDisplayIcon={app}\Kronikar.exe
UninstallDisplayName={cm:AppName}{#NameSuffix}
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
en.AppName=Cosmas
cs.AppName=Kosmas
en.DesktopIcon=Create a desktop shortcut
cs.DesktopIcon=Vytvořit zástupce na ploše
en.Shortcuts=Shortcuts:
cs.Shortcuts=Zástupci:
en.AppComment=Catalogue of game recordings
cs.AppComment=Katalog herních záznamů
en.LaunchApp=Start Cosmas
cs.LaunchApp=Spustit Kosmase
; the whole data folder goes: say exactly what is in it (exported clips and backups too)
en.DeleteData=Also delete your catalogue and everything in its folder: events, characters, attachments, transcripts and other AI data, thumbnails, downloaded models, clips exported from Cosmas and all catalogue backups?
cs.DeleteData=Smazat i tvůj katalog a vše v jeho složce: události, postavy, přílohy, přepisy a další data AI, náhledy, stažené modely, klipy vyexportované z Kosmase a všechny zálohy katalogu?
en.DataFolder=Folder:
cs.DataFolder=Složka:
en.DeleteDataNote=Your recordings in the recording folders (Medal, OBS…) are never touched. If you choose No, everything will be back after the next install.
cs.DeleteDataNote=Tvoje nahrávky ve složkách se záznamy (Medal, OBS…) zůstanou nedotčené. Když zvolíš Ne, při další instalaci bude vše zpět.

[Tasks]
#ifndef TestBuild
; checked by default (no "unchecked" flag); an update keeps the choice made at the first install
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; GroupDescription: "{cm:Shortcuts}"
#endif

[InstallDelete]
; an update replaces the program completely (user data live elsewhere: %LOCALAPPDATA%\Kronikar)
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\app"
#ifndef TestBuild
; shortcuts from before the rename to Kosmas (1.0.0 called the app Kronikář)
Type: files; Name: "{autoprograms}\Kronikář.lnk"
Type: files; Name: "{autodesktop}\Kronikář.lnk"
Type: files; Name: "{autoprograms}\Kronikar.lnk"
Type: files; Name: "{autodesktop}\Kronikar.lnk"
; 1.1.0 named them "Kosmas"; from 1.2.0 the name follows the language (Cosmas / Kosmas) – both are recreated below
Type: files; Name: "{autoprograms}\Kosmas.lnk"
Type: files; Name: "{autodesktop}\Kosmas.lnk"
Type: files; Name: "{autoprograms}\Cosmas.lnk"
Type: files; Name: "{autodesktop}\Cosmas.lnk"
#endif

[Files]
Source: "..\build\dist\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
#ifndef TestBuild
Name: "{autoprograms}\{cm:AppName}"; Filename: "{app}\Kronikar.exe"; WorkingDir: "{app}"; AppUserModelID: "Gingygames.Kronikar"; Comment: "{cm:AppComment}"
Name: "{autodesktop}\{cm:AppName}"; Filename: "{app}\Kronikar.exe"; WorkingDir: "{app}"; AppUserModelID: "Gingygames.Kronikar"; Tasks: desktopicon
#endif

[Run]
Filename: "{app}\Kronikar.exe"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent
; after an update started from the app (silent + /RELAUNCH): start it again
Filename: "{app}\Kronikar.exe"; Parameters: "--updated"; Flags: nowait; Check: WantRelaunch

[UninstallDelete]
; caches Python writes next to the code at run time
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\app"

[Code]
function WantRelaunch: Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/RELAUNCH') = 0 then
      Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\Kronikar');
#ifdef TestBuild
    exit;   { the test app never offers to delete the real catalogue }
#endif
    if (not UninstallSilent) and DirExists(DataDir) then
      if MsgBox(CustomMessage('DeleteData') + #13#10 + #13#10 +
                CustomMessage('DataFolder') + ' ' + DataDir + #13#10 + CustomMessage('DeleteDataNote'),
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
