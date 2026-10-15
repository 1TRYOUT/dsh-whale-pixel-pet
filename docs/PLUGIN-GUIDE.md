# Writing a DSH single-package dual-face plugin

This is the practical guide distilled from building this pet. It covers the shape that lets **one npm
package** ship both a host half (Node, inside the DSH main process) and a client half (browser code
injected into the DSH window).

The exhaustive, verified contract notes live in [`dsh-client-plugin-contract.md`](dsh-client-plugin-contract.md).
This file is the short path: what to write, what bites you, and why.

---

## 1. Package shape

```jsonc
{
  "name": "my-plugin",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["slots"] }
  }
}
```

| File | Runs where | Notes |
|---|---|---|
| `lib/index.js` | DSH main process (ESM) | can use `node:*`, filesystem, `child_process` |
| `lib/client.js` | DSH window (browser) | **not** an ES module — see §3 |
| `cordis.patch.yml` | profile composition | inserts your entry into the plugin tree |

The host half runs in the main process: **changing it needs a DSH restart.** Client halves and assets
are re-materialised on a page refresh (`Ctrl+F5`).

## 2. Host half

```js
export const name = "my-plugin";

export async function apply(ctx) {
  // Always inject: at apply() time the service fiber may not exist yet.
  ctx.inject(["webServer"], (wctx) => {
    const webServer = wctx.get("webServer");
    const dispose = webServer.register({
      kind: "exact",
      path: "/api/my-plugin/assets",
      handler: async (req, res) => { /* serve files, set Cache-Control */ },
    });
    wctx.effect(() => dispose, "my-plugin: static route");   // disposal is not optional
  });
}
```

Rules that saved real debugging time:

- **`ctx.inject(deps, cb)` instead of `ctx.get()` at apply time.** The service may not exist yet.
- **Register a disposer for everything** you create (routes, timers, listeners). `ctx.effect(() => dispose, label)`
  is the pattern; hot reload will otherwise leave duplicates behind.
- **`.unref()` your intervals** if you want the process (and your tests) to exit cleanly.
- **Never trust route payload shapes.** Validate, clamp, cap body size, and answer with a status code.

### Serving your own assets

A read-only `exact` route with `?f=<relative path>` works well for a handful of files:

- resolve the path and **reject anything that escapes your package directory** (traversal guard)
- set a real MIME type — `.webp` in particular must not be `application/octet-stream`
- `Cache-Control: public, max-age=3600` is enough; bump the query for invalidation

Everything your client half needs (JS, CSS, images) can be loaded from that route, so the browser
never needs filesystem access.

## 3. Client half: the lazy-CJS bundle

`lib/client.js` is **not** loaded as an ES module. Its only top-level statement must be the module
loader call, and all side effects live inside the factory:

```js
window.__ModuleLoader__.load({
  id: "my-plugin",
  factory: (require) => {
    const module = { exports: {} };
    // ... your real code, including the exported apply()
    return module;
  },
});
```

Why: the loader may evaluate your bundle more than once (hot reload, re-materialisation). Anything
executed at top level runs again — duplicate DOM nodes, duplicate timers, duplicate listeners.

Inside the factory:

```js
module.exports.apply = function (ctx) {
  if (window.__myPluginBooted) return;      // idempotence guard, always
  window.__myPluginBooted = true;
  // async boot: inject CSS, inject scripts, then start
};
```

**Injecting your own scripts.** Fetch the text from your host route and evaluate it. Guard each
optional piece separately so one missing asset degrades instead of killing the plugin:

```js
injectScript(await (await fetch(BASE + "core.js")).text());
try { injectScript(await (await fetch(BASE + "optional-art.js")).text()); }
catch (e) { console.warn("[my-plugin] optional art missing, using fallback", e); }
```

**UI surface.** React slots are registered on the injected service:

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section", id: "my-section", order: 7, label: "My Plugin",
  render: renderMySection,
}));
```

## 4. Zero-intrusion rules (if you draw over the host)

1. **`pointer-events: none` on the root layer**, and only take over a click in the **capture phase
   when the pointer actually hits your object**. Never swallow a click that wasn't yours.
2. **Never mutate host nodes.** Create your own container, operate inside it, remove it on dispose.
3. **Don't depend on a stylesheet for geometry.** Apply the critical positioning (`position: fixed`,
   insets, zero margins) as **inline styles from JS**, and re-check periodically. If your overlay
   falls back into normal document flow, you push the whole app down and the user sees a white band
   and a scrollbar. This bug is written up in this repo's history; the regression test that catches it
   deliberately loads **no stylesheet**.
4. **Clear your canvas every frame** before drawing. Rendering that only ever draws leaves permanent
   ghosts as soon as the object moves.
5. **Read only what is public and structured.** Prefer service/event data; use DOM markers only as a
   documented fallback; never read message bodies.

## 5. Host-side state: prefer events over scraping

The host exposes a rich event catalog (`agent/status`, `tools/result`, `subagent/start|end`,
`workflow/phase`, `agent/error`, `goal/changed`, …) and services (`goals`, `agents`, `tokenMeter`, …).
Subscribing there gives you state that works **even when the GUI page is closed**.

Write it as a **pure reducer** so it is testable without DSH:

```js
export function reduce(state, eventName, payload, now) {
  const fn = REDUCERS[eventName];
  if (!fn) return state;                   // unknown events are fine
  try { fn(state, payload, now); } catch { state.reducerErrors++; }
  return state;
}
```

Then a thin `apply()` wires real events into it, and a snapshot function turns state into
human-readable lines for the UI.

## 6. Testing without DSH

- **Fake the Cordis context.** `inject(deps, cb)`, `on(name, cb)`, `effect(fn)`, `logger` — that's all
  you need to exercise your routes and event wiring, including firing synthetic events and asserting
  the resulting HTTP response.
- **Fake `req`/`res` as real streams.** `createReadStream().pipe(res)` needs a real `Writable`; a
  plain object will make your file route throw and you'll chase a non-bug.
- **Keep test data out of the user's real directories.** Make paths overridable by environment
  variables (`MY_PLUGIN_STATE_DIR`, `MY_PLUGIN_PID_FILE`); your tests then never touch real state.
- **Add a control experiment** for every "it must not happen" assertion: disable the protection, show
  the failure appears, then re-enable it. An assertion that cannot fail is not a test.

## 7. Checklist before shipping

- [ ] Only the loader call at the top level of the client bundle; everything else inside the factory
- [ ] Boot idempotence guard, and takeover of stale nodes from a previous instance
- [ ] Every route/timer/listener has a disposer
- [ ] Critical layout as inline styles, plus a self-heal check
- [ ] Canvas cleared every frame
- [ ] Asset route guards traversal and sets correct MIME types
- [ ] Host half tolerates unknown payload shapes without throwing
- [ ] Tests run with `node --test` and need no network, no DSH, no browser
