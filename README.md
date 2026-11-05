# Kronikář

Kronika RP: katalog záznamů z Medalu pro evidenci RP – knihovna videí, události s deníkem a přílohami,
databáze postav, časové osy a přehrávač s mixem více zvukových stop najednou.

Spuštění: zástupce **Kronikář** na ploše, nebo `Kronikar.bat`.

## Instalace (Windows)
1. Python 3.12+, pak v kořeni projektu:
   ```
   python -m venv .venv
   .venv\Scripts\pip install -r requirements.txt
   ```
2. **libmpv** (přehrávač): stáhni `mpv-dev-x86_64-…7z` z
   https://github.com/shinchiro/mpv-winbuild-cmake/releases a soubor `libmpv-2.dll` dej do složky `vendor/`
   (do repozitáře se nenahrává – má přes 100 MB).
3. **ffmpeg / ffprobe** na PATH (např. `winget install Gyan.FFmpeg`) – náhledy, průběh stop, export klipů.
4. Spusť `Kronikar.bat`.

Všechna tvoje data (katalog, postavy, přílohy, nastavení i token Discordu) jsou ve složce `data/`,
která se do gitu nenahrává.

## Rozložení
Jako v chatovacích aplikacích pro hráče: vlevo pruh s ikonami her (klik = knihovna hry s bannerem
a nahraným časem, nahoře „RP“ = celý katalog), vedle sloupec s kanály (Katalog / Příběh / Postavy,
strom událostí, filtry knihovny) a dole panel „Přehrává se“ s ovládáním přehrávače. Vpravo seznam
postav (klik = karta postavy); na stránce události jsou nahoře postavy z té události. Při úzkém
okně se seznam postav sám schová.

## Postavy, frakce a hráči
- **Profil postavy** se zobrazuje jen pro čtení, základní údaje upravíš tlačítkem **Upravit** (typ, rod muž/žena,
  stav, přezdívky, hráč, frakce, barva). U mrtvé nebo zmizelé postavy jde zadat datum (reálné i herní),
  poznámku a událost, kde se to stalo.
- **Vztahy** mají typy, které se skloňují podle rodu (milenec/milenka, manžel/manželka, otec/matka ↔ syn/dcera,
  lenní pán ↔ vazal, věřitel ↔ dlužník…), poznámku a jdou upravit. Vlastní text funguje dál.
- **Frakce a rody** – samostatné záznamy s erbem, typem (rod, frakce, cech, řád, město), historií a členy s rolí.
- **Hráči** – lidé za postavami, jeden hráč může mít víc postav. Štítky hráče (např. admin) se ukazují
  i u jeho postav a u momentů, kde jeho postavy jsou.
- **Hromadné úpravy** – Ctrl/Shift + klik v seznamu postav: typ, stav, frakce, hráč, barva, do události, smazat.

## Přehrávač – novinky
- Pod přehrávačem je panel s informacemi o přehrávaném videu (tlačítko se zápisníkem v hlavičce ho skryje).
- Najetí na časovou osu ukáže náhled snímku, pod osou je průběh hlasitosti každé zvukové stopy
  (vygeneruje se na pozadí při prvním přehrání, uloží se do `data/previews`).
- Předvolby zvukových stop (tlačítko s posuvníky, Ctrl+Shift+1…9) a výchozí stopy pro každou hru.
- Video pokračuje tam, kde jsi skončil (červený proužek na kartě, „Pokračovat ve sledování“ na Přehledu).
- `O` / tlačítko **Postava** označí, kdo je ve videu v tomto momentu.
- Snímky a obrázky z videí mají tlačítko „Přehrát video od …“.

## Obrazovky
- **Knihovna** – videa po dnech, filtry podle her/typu/alb/štítků/postav, hledání (Ctrl+F),
  vícenásobný výběr (Ctrl/Shift), přetažení na album nebo na událost, boční panel s úpravami.
- **Události** – strom událostí (přetahováním), stránka události: obálka, čas reálný i herní,
  místo, štítky, postavy s rolemi, **Zápis** (bohatý text), **Deník** (datované zápisy s přílohami),
  **Záznamy** (připojená videa + chytré návrhy), **Přílohy**, **Podudálosti**.
  „Navrhnout ze záznamů“ seskupí neroztříděná videa do herních večerů.
- **Postavy** – profil s portrétem, frakcí, stavem, hráčem, životopisem, vztahy, událostmi,
  videi a zmínkami v deníku.
- **Osa** – čtyři pohledy: Kronika, Osa (zoomovatelný Gantt), Kalendář, Postavy (dráhy).
- **Momenty** – všechny záložky a úseky (virtuální klipy) z videí, seskupené podle záznamu,
  filtr nepřiřazené / v událostech. Záložky udělané v Medalu klávesou se načtou samy
  (automatické herní momenty typu „Double Kill“ jsou skryté, dají se zapnout).
- **Galerie** – všechny screenshoty a snímky z videí.
- **Nastavení** – vzhled (7 motivů, barva zvýraznění, velikost rozhraní, zaoblení, písmo, animace,
  rozložení přehrávače), složky, pravidla klip/záznam, výchozí zvukové stopy, přejmenování her.

## Záložky a úseky
`B` = záložka v aktuálním místě, `Shift+B` = začátek a pak konec úseku, `P` = záložka rovnou do
události. Záložka má název, poznámku, barvu, postavy a událost; úsek se přehraje a sám zastaví.
Najdeš je v Momentech, v inspektoru videa v Knihovně, u události (Záznamy → Momenty), u postavy
a na Ose jako praporky.

## Snímky a portréty
`S` / **Snímek** v přehrávači nabídne: celý snímek do události, výřez do události, nebo
**portrét postavy** (ořez 4:5 / 1:1 / 16:9 / volně). Portrét jde vyříznout i z profilu postavy.

## Editor textu
`@` označí postavu (nebo rovnou vytvoří novou), `Ctrl+V` vloží screenshot, tlačítka pro nadpisy,
citace, seznamy, datum a **snímek z přehrávače**.

## Přehrávač
Zvukové stopy jako přepínače (kolečko = hlasitost stopy, pravé tlačítko = posuvník / jen tato stopa),
posuvník se značkami momentů z Medalu (zlaté) a odkazů z událostí (červené).
**Snímek** uloží aktuální obraz do události, **Připnout** připojí okamžik videa k události.
Tlačítko vedle otevře přehrávač ve vlastním okně, F / dvojklik = celá obrazovka.
Další tlačítko přepne rozložení: přehrávač vedle obsahu, nebo nahoře s obsahem pod ním.
Dekódování videa běží na GPU (libmpv, `hwdec=auto-safe`, `vo=gpu-next`).

## Data
- Vše, co upravíš, je ve složce `data/` (catalog.db, settings.json, thumbs/, attachments/). Zálohuj ji.
- Databázi Medalu aplikace jen čte. Mazání videí posílá soubory do Koše.
- `extras/multitrack-mix.lua` – samostatný skript pro obyčejné mpv.

## Technika
Python 3.12 + PySide6 (Qt WebEngine pro rozhraní v `rpcatalog/web/`, offline), libmpv
(`vendor/libmpv-2.dll`), ikony Lucide, ffmpeg/ffprobe pro náhledy videí mimo Medal.
Most mezi Pythonem a webem: `rpcatalog/api.py` (QWebChannel).

## Discord
- **Hráči bez serveru:** stačí token bota (bot nemusí být nikde pozvaný) a u hráče „Propojit podle ID“ – stáhne jméno
  a avatar z veřejného profilu. Discord ID: Nastavení → Pokročilé → Režim vývojáře, pravý klik → Kopírovat ID uživatele.
- **Hráči ze serveru:** Nastavení → Discord: token bota + ID serveru → „Načíst členy a vytvořit hráče“ (jméno a avatar),
  u hráče „Propojit s Discordem“, „Aktualizovat jména a avatary“. Bot potřebuje zapnutý *Server Members Intent*.
- **Holubí pošta ze schránky (PM):** v Discordu označ zprávy tažením myši, Ctrl+C, v Holubí poště Ctrl+V
  (nebo Přidat → Vložit ze schránky). Rozpozná autora, čas a text, předvybere zprávy se slovem „holub“,
  autora přiřadí k postavě podle hráče, opakované vložení nevytvoří duplikáty.
- **Holubí pošta:** dopisy (zprávy se slovem „holub“, slovo jde změnit) z kanálu na serveru přes bota
  (*Message Content Intent*), z oficiálního exportu dat Discordu (jen tvé vlastní zprávy), nebo ručně.
  Cizí soukromé zprávy Discord automaticky nevydá – boti k nim nemají přístup a automatizace osobního účtu
  je proti pravidlům Discordu.

## Svět, servery a klipy
- **Servery:** pod každou hrou (levý pruh) jde přidat servery s obdobím, kdy se na nich hrálo – videa se přiřadí
  sama; výběr serveru filtruje knihovnu, události, postavy, frakce, místa i osu. Nové věci se zakládají
  do vybraného serveru.
- **Místa:** hrady, města, krčmy… s vlastníkem (postava / frakce = državy), nadřazeným místem a událostmi.
- **Vzhled podle frakce:** postava bez vlastní barvy převezme barvu a erb první frakce.
- **Klipování:** `I` začátek, `O` konec (okraje jdou táhnout na ose) → Přehrát výběr / Uložit klip /
  Export MP4 (všechny zvukové stopy, do `data/clips`). `T` = aktuální snímek jako náhled videa.
  Označení postavy v momentu je teď `C`.

## Přepisy, obraz a Kronikář AI (lokální AI)
Všechno běží na tvém počítači (grafická karta NVIDIA), nic se nikam neposílá a nic se neplatí.
- **Instalace (jednou):** `.venv\Scripts\pip install -r requirements-ai.txt`. Model řeči (Whisper large-v3, ~3 GB)
  se stáhne sám při prvním přepisu. Pro obraz a Kronikáře AI nainstaluj [Ollamu](https://ollama.com) a `ollama pull qwen3.8:27b`.
- **Spuštění:** v panelu videa sekce **Přepis**, pro víc videí pravý klik → Přepis, pro celou knihovnu stránka
  **Přepisy** → „Přepsat chybějící“. Fronta běží na pozadí jedno video po druhém; po přerušení (i zavření aplikace)
  naváže, kde skončilo.
- **Řeč:** každá zvuková stopa zvlášť – **Já** (mikrofon), **Hra** (hlasový chat ve hře, NPC), **Discord**.
- **Obraz:** hlavně během rozhovorů – když se scéna mění (chůze po světě), snímek každých ~8 s; když postavy sedí
  a obraz se nemění, jen občas. Model čte **jmenovky nad postavami** (propojí je s postavami a hráči) a při rozhovorech
  se hledají **tváře** – klik na tvář ji nastaví jako portrét postavy. Jakýkoli úsek jde dopracovat ručně:
  na pruhu pokrytí v panelu videa táhni myší → „Popsat obraz“.
- **Kronikář AI:** po přepisu projde záznam silnější textový model po blocích (dělených v pauzách mezi rozhovory,
  pauzy jsou v textu vyznačené) s průběžnou pamětí děje, se shrnutím předchozího večera stejné hry a se znalostí
  postav, míst a frakcí z databáze. Vytvoří kapitoly, shrnutí večera, zmínky (uloží se rovnou k postavám, místům,
  frakcím) a **návrhy** nových událostí, postav, míst a frakcí – přijímají se jedním klikem (stránka Přepisy → Návrhy,
  nebo v panelu videa); událost dostane odkaz do videa s časem, místo a postavy.
- **Kde to je vidět:** pruh pokrytí (co je přepsané / popsané / nezpracované), přepis s kapitolami, pauzami,
  zvýrazněnými jmény, náhledy snímků, jmenovkami a tvářemi; na kartách v Knihovně ikony řeči a obrazu; hledání
  v Knihovně podle toho, co zaznělo; u postav, míst a frakcí sekce „V záznamech (přepis)“; titulky v přehrávači (V).
- **Fronta a výkon:** stránka **Přepisy** – aktuální video s krokem, průběhem, odhadem času a rychlostí, pořadí fronty
  (přetažením), historie, vytížení GPU/VRAM/teploty/CPU/RAM. Ukazatel v levém sloupci. Když hraješ (hra ze Steamu,
  Epicu, Xboxu, GOG… nebo z nastaveného seznamu), přepisy se samy pozastaví a po hře pokračují.
- **Nastavení:** Přepisy → Nastavení (modely, jazyk, stopy, hustota snímků, citlivost, jmenovky, tváře, model a délka
  bloků Kronikáře, kontext o hře a serveru, priorita, pauza při hraní).
- Výsledky: `data/analysis/<id>/` (přepis po částech, snímky, tváře, `chronicle.json`, `timeline.md` – celý večer jako text).
- Rychlost na RTX 4090: řeč ~45× rychleji než reálný čas, popis snímku 3–9 s, Kronikář ~1 min na blok.

## Obrázky her
Ikony v levém pruhu a bannery knihovny se při prvním spuštění samy doplní ze Steamu v tomto PC.
Jinak pravý klik na ikonu hry → „Ikona a banner hry…“: Steam v PC (obal, logo, hero), obchod Steam (hledání),
ikony z Medalu, soubor, URL, schránka nebo snímek z videa – vše s ořezem.

## Výchozí hodnoty
- Server: když má hra jediný server, je výchozí; jinak pravý klik na server → „Nastavit jako výchozí“. Videa bez
  serveru i nové postavy, události, frakce a místa (když je vybraná hra) dostanou výchozí server.
- Nová postava má typ „Postava“ (dřív NPC). Hromadné úpravy postav: Ctrl/Shift + klik a pravé tlačítko.
