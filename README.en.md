# 🐋 Whale-girl — a desktop pet for DeepSeek Harness (DSH)

A whale-girl desktop pet that **knows what your agent is doing**: she tilts her head while the model
thinks, picks up a laptop when a tool runs, holds an hourglass while an approval is pending, and
wilts when something errors. Pet her, feed her, praise her — she grows with your token usage.

**Default form: a standalone desktop window.** She is a transparent, frameless, always-on-top
Electron window that floats above everything on your desktop — minimize or even close DSH and she
stays. The DSH plugin half is still installed, but by default it **does not draw her inside the DSH
window**: it keeps collecting busy/idle signals and relays them to the desktop pet.

> 中文文档见 [README.md](README.md)。

![Her sprites (92, MIT licensed)](docs/screenshots/art-contact-sheet.png)

## Features

**Session awareness** — poses driven by real DSH signals, not a timer:

| DSH state | Her reaction |
|---|---|
| model is thinking | thinking pose |
| a tool is running | working pose (tool-specific art: deploy / debug / review / meeting / boss) |
| waiting for your approval | waiting pose + hourglass |
| something errored | sad pose (auto-clears once a later tool succeeds) |
| idle | idle, wanders, gets sleepy after a while |

**Interaction**

- **Petting** — three zones (head / belly / tail), each with its own reaction art
- **Feeding** — 6 foods with different effects. She has a **favourite and a disliked food, derived
  from her name**, and the taste is *discovered*: feed her the favourite and she lights up
  (+10 mood, +4 bond, star-eyes); feed the disliked one and she eats it politely but mood drops.
  The menu only marks her favourite with ★ after you've found it.
- **Praise / Play / Sleep** — play costs energy and she refuses when exhausted
- **Walk** — in the desktop form the **whole window walks across your screen** (150 px/s), pausing
  once or twice on the way: if your cursor is nearby she greets you, otherwise she just enjoys the view
- **Task / progress / usage HUD** — three lines by her feet:
  current task (from the session goal), progress (tool steps, subagents, workflow phase, elapsed),
  and usage (real token count)

**Looks** — 92 MIT-licensed sprites, plus a built-in pixel-art renderer you can switch to at any
time (and which is the automatic fallback if the sprite folder is missing).

## Install (DSH plugin)

```powershell
dsh plugin --profile <your-profile> add <path-to-this-repo>
```

Then reload the DSH window (`Ctrl+F5`). Changes to `lib/index.js` (the host half) need a DSH restart.

Verify in the DSH devtools console:

```js
window.__dshWhalePixelPetBooted                          // true
document.querySelectorAll('[data-dsh-whale-pet-root]').length  // 1
window.__dshWhalePixelPet.stats()                        // { pose, ambient, level, ... }
```

Settings live in **DSH Settings → 桌宠 (Pet)**.

## Desktop form (standalone window)

Easiest: **DSH Settings → 桌宠 → 桌面桌宠** card → *Start desktop pet*.

Or from a terminal:

```powershell
.\desktop\start-pet.cmd     # start
.\desktop\stop-pet.cmd      # stop
```

| Behaviour | How it works |
|---|---|
| Always on top | `alwaysOnTop('screen-saver')` |
| **Click-through** | The main process polls the OS cursor position and toggles `setIgnoreMouseEvents`, so clicks pass through everywhere except her body (Electron's `forward` mouse-move events are unreliable on Windows — that's why it's polled) |
| Drag to move | Dragging moves the *window*; the position is remembered in `%APPDATA%\dsh-whale-pet-desktop\position.json` |
| Right-click | Native menu: pet / praise / play / walk / feed ▸ / sleep / art style ▸ / palette ▸ / settings panel / back to corner / hide / quit |
| Tray | Show-hide, back to corner, open DSH, quit |
| Auto-start | On by default: when DSH starts, the host half launches her (config: `%LOCALAPPDATA%\dsh-whale-pet\config.json`) |
| State relay | Host half writes `%LOCALAPPDATA%\dsh-whale-pet\state.json`; she reads it every 1.5 s. Works with the DSH window closed because the host half subscribes to session events itself |

### Runtime requirement

The desktop form uses Electron. This project does **not** bundle it — the launcher looks for a
runtime at `%LOCALAPPDATA%\dsh-whale-pet\runtime\electron.exe`. Point it elsewhere with
`$env:DSH_PET_ELECTRON`.

One gotcha worth knowing: the launcher must clear **`ELECTRON_RUN_AS_NODE`**, otherwise Electron
degrades into plain Node and no window ever appears.

## Architecture

```text
assets/whale-pet.js         behaviour engine (states, needs, growth, particles, pixel renderer)
assets/art-musume.js        sprite layer: pet state -> sprite file (optional, falls back)
assets/pet-actions.js       shared actions — BOTH hosts call this single implementation
assets/whale-pet-overlay.js in-window overlay (zero-intrusion layer + settings panel)
assets/host-signal.js       reads public DOM markers + structured session state
lib/index.js                host half: static asset route, state relay, desktop control, status collector
lib/status.js               pure reducer: session events -> task / progress / usage snapshot
lib/client.js               client half: boot, settings UI, state reporter
desktop/                    standalone Electron app (main / preload / renderer)
```

Two design decisions worth stealing:

1. **One implementation of every action.** The in-window pet and the desktop pet both call
   `assets/pet-actions.js`. They used to have separate copies — which is exactly how the desktop
   version silently lost half its features.
2. **The signal collector is a pure reducer.** `lib/status.js` folds session events into a snapshot
   and ignores anything it doesn't recognise; unknown payload shapes leave a line blank instead of
   throwing. DSH internals can change without breaking the pet.

## Privacy / zero intrusion

- The overlay is a `pointer-events: none` layer. It only intercepts a click in the **capture phase
  when the pointer is actually on her body**.
- It never modifies host DOM nodes or built-in package files.
- It reads only public structured markers, session run state, the **session goal text, tool names
  and event counters** — never chat message bodies.
- Everything is local. No network requests, no telemetry.
- Data is stored in the host origin's `localStorage` (`whale-pet:v1`) and, for the desktop form, in
  `%LOCALAPPDATA%\dsh-whale-pet\`.

## Tests

```powershell
node --test test/engine.test.mjs test/art.test.mjs test/actions.test.mjs test/status.test.mjs test/host.test.mjs
```

95 unit tests (engine, sprite layer, shared actions, status reducer, host routes) plus 90 headless
browser assertions across three pages in `tools/` (layout safety without the stylesheet, render
cleanliness while dragging, end-to-end session-signal integration). Two of them ship **control
experiments** proving the assertions can actually fail.

## Writing your own DSH plugin

The dual-face (host + client) package shape, the lazy-CJS client bundle, the zero-intrusion rules and
the testing approach are written up in [docs/PLUGIN-GUIDE.md](docs/PLUGIN-GUIDE.md).

## Roadmap

What could come next (with a survey of comparable open-source projects and reasonings for what *not* to
do) is in [docs/ROADMAP.md](docs/ROADMAP.md).

## License

Code: MIT — see [LICENSE](LICENSE).
Sprites: MIT, © Sutera-Diffusus — see [THIRD-PARTY.md](THIRD-PARTY.md). Delete `assets/art/` and the
pet falls back to the built-in pixel renderer; nothing else breaks.

Design references: [dsh-desktop-pet](https://github.com/xiaoshihou514/dsh-desktop-pet),
[WhaleIsle](https://github.com/ChisaAlter/WhaleIsle),
[dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume) (sprites).
