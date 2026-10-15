# Power Scheduler

A small desktop app to shut down, restart, or sleep your PC — instantly or on a schedule.

- **Instant** — click Sleep / Restart / Shut down. A 5-second countdown lets you cancel a misclick (Esc).
- **Schedule** — run an action after a delay (with 15 min / 30 min / 1 h / 2 h presets) or at a time of day.
  You get a notification 1 minute before it fires, and can extend (+15 min) or cancel.
- Closing the window while a schedule is active keeps the app in the system tray so the timer still fires.
- If the PC was asleep when a schedule came due, the action is skipped instead of firing on wake.

## Run

```
npm install
npm start        # real mode — actions really happen
npm run dev      # dry run — commands are only logged, nothing shuts down
```

## Build a Windows .exe

```
npm run dist     # outputs an installer and a portable exe in dist/
```

Built with Electron (HTML/CSS UI, no framework). Power commands live in `src/power.js`
(Windows: `shutdown /s /f`, `shutdown /r /f` — force-closes open apps — and `SetSuspendState`; macOS and Linux are also supported).
