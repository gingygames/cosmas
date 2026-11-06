; Kronikář – Windows installer (Inno Setup 6). Built by installer/build.py, which passes AppVer.
; Per-user install: no administrator rights, nothing outside the user's profile.

#ifndef AppVer
  #define AppVer "1.0.0"
#endif

[Setup]
AppId={{71435C9E-FB7D-42CC-8F2D-74A5F81ABB76}
AppName=Kronikář
AppVersion={#AppVer}
AppVerName=Kronikář {#AppVer}
AppPublisher=gingygames
AppPublisherURL=https://github.com/gingygames/kronikar
DefaultDirName={localappdata}\Programs\Kronikar
DefaultGroupName=Kronikář
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
UninstallDisplayName=Kronikář
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=8
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "cs"; MessagesFile: "compiler:Languages\Czech.isl"

[Tasks]
Name: "desktopicon"; Description: "Vytvořit zástupce na ploše"; GroupDescription: "Zástupci:"

[InstallDelete]
; an update replaces the program completely (user data live elsewhere: %LOCALAPPDATA%\Kronikar)
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "..\build\dist\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Kronikář"; Filename: "{app}\Kronikar.exe"; WorkingDir: "{app}"; AppUserModelID: "Gingygames.Kronikar"; Comment: "Katalog herních záznamů"
Name: "{autodesktop}\Kronikář"; Filename: "{app}\Kronikar.exe"; WorkingDir: "{app}"; AppUserModelID: "Gingygames.Kronikar"; Tasks: desktopicon

[Run]
Filename: "{app}\Kronikar.exe"; Description: "Spustit Kronikáře"; Flags: nowait postinstall skipifsilent

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
      if MsgBox('Smazat i tvůj katalog (události, postavy, přepisy, náhledy a stažené modely)?' + #13#10 + #13#10 +
                'Složka: ' + DataDir + #13#10 + 'Videa samotná se nesmažou. Když zvolíš Ne, při další instalaci bude vše zpět.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
