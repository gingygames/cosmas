# Kronikář v prohlížeči (prototyp)

Webová „lite“ verze Kronikáře, která běží v Chrome / Edge, čte videa přímo ze složky Medalu na disku
a **nic nikam nenahrává**. Katalog, události, postavy, deníky i přílohy se ukládají jen v prohlížeči.
Desktopová aplikace zůstává hlavní verzí – tohle je prototyp, který ukazuje, co v prohlížeči jde a co ne.

## Spuštění

Z **kořene repozitáře** (webová verze sdílí UI ze `rpcatalog/web/`):

```
python -m http.server 8000
```

a otevři <http://localhost:8000/web-app/> v Chrome nebo Edge. Pak **Vybrat složku Medalu**
(např. `C:\Users\…\Videos\Medal`). Jiný prohlížeč (Firefox, Safari) složku otevřít neumí.

Stačí jakýkoli statický server – žádný backend, žádná data na serveru. Adresa musí být `localhost`
nebo HTTPS (File System Access API funguje jen v „secure context“).

## Jak je to postavené

| Část | Desktop | Web |
|---|---|---|
| UI | `rpcatalog/web/*.js` v QtWebEngine | **stejné soubory**, beze změn (kromě 2 drobností níže) |
| Backend | Python `api.py` přes QWebChannel | `web-app/js/backend.js` – port `api.py`, stejný most `call(method, args, cb)` + `notify` |
| Katalog | SQLite `data/catalog.db` | SQLite v prohlížeči (**sql.js**/WebAssembly), **stejné schéma** jako `store.py`, soubor DB uložený v IndexedDB |
| Přílohy, vlastní náhledy | `data/attachments/`, `data/thumbs/` | bloby v IndexedDB |
| Složka Medalu | cesta na disku | `FileSystemDirectoryHandle` (uložený v IndexedDB, přístup se po restartu prohlížeče potvrdí jedním klikem) |
| Medal DB (`Databases/medal-*.db`) | sqlite3 nad kopií | sql.js nad kopií v paměti; WAL soubor se aplikuje ručně (`medal.js`) |
| Délka videa bez metadat | ffprobe | `<video>` načte metadata |
| Náhledy | Medal / ffmpeg | Medal / snímek přes `<video>` + `<canvas>` |
| Přehrávač | libmpv, mix všech stop | HTML5 `<video>` v panelu vpravo |

Změny ve sdíleném UI: `core.js` si vybere most podle prostředí (`window.KronikarWeb` → web, jinak
QWebChannel) a `settings.js` ve webu skryje kartu Discordu a kartu „Data“ přepne na zálohu.

Soubory: `web-app/index.html`, `web-app/js/` (`idb.js` úložiště, `medal.js` Medal DB, `store.js` katalog,
`scan.js` složky + skenování, `suggest.js` návrhy, `player.js` přehrávač, `backend.js` API),
`web-app/vendor/` (sql.js 1.11.0, MIT).

## Co funguje (ověřeno)

- Otevření složky Medalu, projití `Clips/<hra>/…`, načtení Medal DB – u všech 111 záznamů ze
  skutečné databáze dává JS stejné výsledky jako Python (hra, typ klip/záznam, čas, délka, název,
  stopy, záložky).
- Knihovna s náhledy (Medalu, nebo vygenerovanými v prohlížeči), hry, filtry, momenty, galerie,
  časová osa, události, deníky, postavy, frakce, místa, hráči, dopisy, servery, alba.
- Přehrávání včetně HEVC (v Chromiu s hardwarovou podporou), záložky (B), úseky (Shift+B),
  záložka do události (P), „kdo je ve videu“ (C), snímek do události / portrét (S),
  snímek jako náhled videa (T), pokračování tam, kde jsi skončil, obraz v obraze.
- Vše přežije reload stránky i restart prohlížeče.
- **Záloha do JSON a obnova** (Nastavení → Data katalogu): tabulky + přílohy; náhledy se po obnově
  vygenerují znovu. Přenos mezi počítači.
- **Převzetí dat z desktopu**: vybereš složku `data/` desktopového Kronikáře, převezme se `catalog.db`
  i přílohy; videa se při načtení složky Medalu spárují podle cesty a zůstanou jim záložky,
  události i postavy (ověřeno na reálných datech: 121 videí, 8 postav s portréty, 35 záložek).
- Jen jedna záložka prohlížeče najednou (Web Locks) – dvě by si přepisovaly katalog.

## Limity

**Zvukové stopy.** Prohlížeč přehraje jen **první** zvukovou stopu souboru. U Medalu je první stopa
„All Audio“ (celý mix), takže slyšíš všechno – ale nejde vypnout mikrofon / Discord / hru zvlášť.
`HTMLMediaElement.audioTracks` je v Chrome jen za přepínačem *Experimental Web Platform features*
(`chrome://flags`) – když je zapnutý, přehrávač umí stopy přepínat (vždy jednu). Skutečný mix více
stop najednou by šel jen přes vlastní demux (mp4box.js) + WebCodecs + Web Audio – to je velký kus
práce a výkonově na hraně u dlouhých záznamů. **Samostatné zvukové soubory** vedle videa
(`X_Mic.mp4`, `X_Discord.mp4`) se přehrávají synchronně přes `<audio>` a jdou zapínat.

**HEVC (H.265).** Skoro všechna videa z tvého Medalu jsou HEVC (93 z 95). Chrome na Windows HEVC
přehraje jen s hardwarovou podporou GPU (většina karet od cca 2016); Edge navíc potřebuje
„HEVC Video Extensions“ z Microsoft Store. Firefox složku stejně neotevře. Když kodek nejde,
přehrávač to napíše a náhled se vezme z Medalu.

**Další rozdíly proti desktopu**
- Export klipu (ffmpeg) není – úseky (Shift+B) fungují jako virtuální klipy. Šlo by doplnit přes
  ffmpeg.wasm (stream copy bez překódování, soubor připojený přes WORKERFS), ~30 MB navíc.
- Náhledy snímků při najetí na osu a průběh hlasitosti stop nejsou (desktop je dělá ffmpegem).
- Mazání videí do koše, „Zobrazit ve složce“ a otevření příloh v systémové aplikaci nejdou
  (prohlížeč složku jen čte; přílohy se otevřou v nové záložce).
- Discord (bot, import dopisů) nejde – Discord API nepovoluje volání z webové stránky.
- Videa, která Medal uložil mimo vybranou složku, se nenačtou (desktop je najde podle absolutní cesty).
- Po restartu prohlížeče je potřeba jedním klikem znovu povolit přístup ke složce (Chrome 122+
  nabízí „Povolit při každé návštěvě“, pak odpadá).
- Data žijí v profilu prohlížeče: vymazání dat webu = smazaný katalog. Proto záloha do JSON
  (a aplikace žádá o trvalé úložiště `navigator.storage.persist()`).
- Katalog se po každé změně ukládá celý (export SQLite). U stovek videí je to pár ms; u desítek
  tisíc záznamů by se vyplatilo SQLite přímo v OPFS (oficiální sqlite-wasm).

## Doporučení

1. **Desktop nech jako hlavní verzi.** Kvůli tomu, co je pro RP archiv nejdůležitější – mix stop
   (vypnout mikrofon / Discord), náhledy na ose, export klipů, HEVC všude – web desktop nenahradí.
2. **Web má smysl jako doplněk**: rychlé prohlížení a zapisování (události, deník, postavy) na jiném
   počítači bez instalace Pythonu/mpv, nebo pro kamaráda, kterému pošleš odkaz a on si otevře svou
   vlastní složku Medalu. Data zůstávají u každého lokálně, nic se nenahrává.
3. Pokud se web má rozvíjet, pořadí: (a) hostovat jako statickou stránku na HTTPS (GitHub Pages)
   + PWA, aby šel „nainstalovat“; (b) synchronizace s desktopem přes JSON/`catalog.db` je hotová –
   šlo by přidat i opačný směr (web → desktop); (c) export klipu přes ffmpeg.wasm; (d) mix stop přes
   WebCodecs až nakonec, je nejdražší.
