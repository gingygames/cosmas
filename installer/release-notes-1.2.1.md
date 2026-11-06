## Cosmas 1.2.1 Beta

The first beta of Cosmas (Czech **Kosmas**): everything from 1.2.0 plus the fixes from a full review of the app, the web
chronicle and the website. **If you installed 1.2.0, please update** – it had a bug that made taking over an existing
catalogue fail on the first start.

Ready for everyday use; please report anything odd with **?** → *Report a bug* in the title bar.

### New in 1.2
- **Updates inside the app**: checks after the start and every 12 hours, downloads in the background, verifies the SHA-256,
  *Restart and install*. Stable or beta channel, skip a version, or turn checks off.
- **Send feedback / Report a bug** from the **?** menu, with an optional (redacted) log, screenshot and a preview of exactly
  what is sent; works offline. After an unexpected error the app offers to send a report.
- **Settings in sections**, **automatic daily backups** (newest 7 kept) with *Restore…* and *Export as JSON…*.
- Start minimized, keep running in the notification area, rescan interval, resume videos, frame-by-frame with `,` and `.`.
- In English the app is called **Cosmas**, in Czech **Kosmas**.

### Fixed
- **Taking over an existing catalogue on the first start always failed** (the new log file was open). Fixed and tested.
- **A write-up could be saved into another event** (or a biography into another character) when you switched quickly
  after typing. Every editor now saves only into its own record and only when something changed.
- **Restoring a backup was undone by the next sync.** After a restore, differences with the web become conflicts you decide;
  nothing is deleted silently.
- **Quick edits of two fields** (factions, places, players, letters, AI settings) now save both.
- Changing the game of a video by hand survives rescans; rescans are much lighter (cached probes, failed thumbnails are not
  retried every time) and no longer reload the whole window.
- Only one Cosmas runs per data folder; starting it again shows the running window.
- The log can no longer freeze the app; the AI worker log is capped and a crashing worker restarts with a pause.
- English users get English transcription and AI chapters by default (Czech for a Czech interface).
- A copy unpacked from a ZIP no longer tries to update itself into the wrong folder.
- Exported clips use safe folder names; error messages no longer start with technical class names.
- Dialogs: Escape closes only the top one, buttons can't be clicked twice while working, keyboard focus stays inside.

### Privacy and security
- Rich text coming from the web or pasted is cleaned before it is shown, and the app window only runs its own scripts.
- The Discord bot token is no longer sent to the app's page; changing the sync server signs you out instead of sending
  your token to the new address.
- The share dialog now says plainly that syncing uploads your whole catalogue to your **private** web chronicle and only the
  shared record becomes visible; that a character used on Discord gets a card with its link in the community forum; and
  that videos show on a public event only when the video itself is published.
- Uninstalling explains exactly what *Delete the catalogue* removes (catalogue, attachments, AI data, exported clips,
  backups). Recordings in your recording folders are never touched.
- Feedback: the log is attached only when you tick it.

### Web chronicle (gingygames.com/kosmas)
Fixed together with this release: several access-control holes in the public chronicle (no private record, image or
link-only record can be reached by others any more), a stricter HTML filter, Content-Security-Policy, and nicer link
previews.

**Download:** `Cosmas-Setup-1.2.1.exe` below (Windows 10 1809+ / 11, 64-bit). Installed copies update themselves
(Settings → General → Updates). Windows may show *Windows protected your PC*: click **More info → Run anyway**.

SHA-256: `{sha}`
