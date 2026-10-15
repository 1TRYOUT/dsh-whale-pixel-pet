# DSH client-side Cordis plugin — exact authoring contract

**Target:** DeepSeek Harness **0.2.0-rc.2**, Electron desktop shell `@deepseek-ai/dsh-desktop@0.2.0-rc.2`, live profile `desktop`.
**Verified on this machine:** `C:\Users\l3561\AppData\Local\Programs\DeepSeek Harness\` (`version` file + `app.asar:/package.json` both say `0.2.0-rc.2`; `/dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime@0.2.0-rc.2`).
**Runtime facts observed live:** `DSH_HOME=C:\Users\l3561\.dsh`, `DSH_PROFILE=desktop`, `DSH_PROFILE_DIR=C:\Users\l3561\.dsh\profiles\desktop`, `DSH_WEB_URL=http://127.0.0.1:19387`.

Citation conventions used below:

| Prefix | Means |
|---|---|
| `app.asar:/dsh/...` | member **inside** `resources\app.asar`, line number within that member |
| `SKILL(cordis-plugin-development):NN` | `C:\Users\l3561\.dsh\profiles\node_modules\@deepseek-ai\dsh-agent-presets\presets\cordis\skills\cordis-plugin-development\SKILL.md` |
| `SKILL(editing-cordis-compositions):NN` | the sibling `editing-cordis-compositions\SKILL.md` |
| `desktop/package.json:NN` | `C:\Users\l3561\.dsh\profiles\desktop\package.json` |
| `whale-musume:<file>:NN` | `E:\Web\deepseel mena\research\whale-musume\<file>` (fetched from GitHub) |

Reader tool used for asar: [`tools/asar-read.mjs`](../tools/asar-read.mjs) (written for this task; `list` / `find` / `cat` / `grep`). Header layout actually verified: `[u32 payloadSize=4][u32 headerPickleLen][u32 jsonLen][json]` → JSON starts at byte **16**, data section at **16 + jsonLen** (not `16 + headerSize`).

---

## 1. Authoritative sources (ranked)

| # | Source | Why it is authoritative |
|---|---|---|
| 1 | `app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js` (41 704 B) and its `README.md` | the **only** validator of `dsh.client` and the only scanner that turns a package into a browser bundle |
| 2 | `app.asar:/dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js` (≈5 000 lines) | live **Client Service / Event / Slot catalog** with per-slot `kind`, `scope`, `registerOptions`, `standardProps`, `occupants`, and copy-pasteable `example` code |
| 3 | `app.asar:/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/{SKILL.md,references/*,templates/decoration/*}` | the shipped, version-matched authoring skill **including a working 4-file client-plugin template** |
| 4 | `app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js` §166–194 | the exact `register()` option validation and its error strings |
| 5 | `app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js` §74/§88/§345 | `shell.overlay` render site + the real `overlayLayer` CSS (`pointer-events`) |
| 6 | `app.asar:/lib/main.js` (`dsh-app` protocol) §6222, §11020, §11543–11551 | desktop origin, scheme privileges, and the `/assets/**` interception that makes some route prefixes unreachable |
| 7 | `app.asar:/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js` §95 + `dsh/lib/bin.js` §37,§120 + `dsh/lib/plugin-BGnVfe_D.js` §11–12 | the **only** CLI allowed to manage the `desktop` profile |
| 8 | `app.asar:/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/operations.js` §44–74 (bundle reconcile), §247 (`runProfilePnpm`) | proves whether an install auto-selects your bundle |
| 9 | `app.asar:/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml` §28–33 + `dsh-hmr/README.md` | live patch-reload semantics: enabled by default with `root: []` |
| 10 | `SKILL(cordis-plugin-development)` / `SKILL(editing-cordis-compositions)` (on-disk, v0.1.5-rc.2 wording) | the skills your session advertises |
| 11 | `whale-musume:lib/client.js` (543 lines) + `whale-musume:docs/desktop-0.2.0-rc.2-contract.md` (1 517 lines) | third-party but version-matched, end-to-end working example |
| 12 | `dsh-desktop-pet:src/main.cjs` / `src/shared.cjs` | the *separate-process* Electron overlay alternative (no plugin at all) |

> ⚠️ **Version split on this machine.** `C:\Users\l3561\.dsh\profiles\node_modules\@deepseek-ai\*` is a **0.1.5-rc.2** store (shared fallback closure for the *web* profile). The **desktop** profile does **not** resolve from there — `desktop/node_modules` does not exist and `desktop/package.json` has `"dependencies": {}` (`desktop/package.json:4`). The desktop app resolves from the asar runtime `app.asar:/dsh/node_modules`, version **0.2.0-rc.2**. Every API claim in this document was re-verified against the **0.2.0-rc.2 asar**, not the 0.1.5-rc.2 store — several things differ (§9).

---

## 2. The two named skills: where they are, and why they "failed to load"

There are **two different skill sets with these names** on this machine.

### 2.1 On disk (what your session advertises)

```
C:\Users\l3561\.dsh\profiles\node_modules\@deepseek-ai\dsh-agent-presets\presets\cordis\skills\
    cordis-plugin-development\SKILL.md            (420 lines)
    editing-cordis-compositions\SKILL.md          (165 lines)
```

These are real and readable. **There are no `references/`, `templates/`, or asset subdirectories** — a recursive listing of that preset returns exactly those two files. Any skill-loader step that also resolves the skill's advertised reference/template table will fail, which is the most likely cause of "failed to load". Both `SKILL.md` files are ordinary UTF-8 and read fine.

### 2.2 Inside the asar (the version-matched originals)

```
app.asar:/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/
    cordis-plugin-development\SKILL.md                                  (8 144 B)
    cordis-plugin-development\references\{host-plugin,ui-plugin,mcp-bundle,practices,user-actions,verification}.md
    cordis-plugin-development\templates\decoration\{package.json,cordis.patch.yml,index.js,client.js}
    cordis-plugin-development\templates\mcp\{package.json,cordis.patch.yml}
    editing-cordis-compositions\SKILL.md
    cordis-composition-reference\{SKILL.md,references/packages.md}
```

The asar `cordis-plugin-development/SKILL.md` explains the failure mode itself:

> "In Desktop the directory sits inside `app.asar`, which only the Host process's own file reads can open; shell commands (`ls`, `cat`, `cp`, `cmp`), the glob and search tools (they run a native ripgrep process), `node`, and pnpm all fail on it. Never install or syntax-check a template in place; copy its contents into the workspace first."

### 2.3 Key rules, quoted

**From the on-disk `cordis-plugin-development` SKILL.md** (dynamic/runtime Cordis plugin workflow — the `cordis_define`/`cordis_run` family):

- `SKILL:8` "First determine whether a capability belongs on Host or Client, then query the real interface before writing code. **Never infer a complete API from a Service name, Event payload, Slot props, theme token, or example.**"
- `SKILL:63-71` "Both `code.host` and `code.client` are **plain JavaScript function bodies** that return a Cordis Plugin. They are not compiled by TypeScript, JSX, or a bundler. Do not use: `import`, `require`, TypeScript types, `as`, decorators, or JSX; globals not confirmed by `Builtin.listBuiltins`; guessed access to `window`, `document`, `process`, `Buffer`, `fetch`, or native timers."
- `SKILL:102-125` "Read optional capabilities with `ctx.get(name)` by default and handle their absence… Declare `inject` only when a Service is a **hard** dependency… Do not access `ctx.requiredService` without declaring the injection; the Guard rejects undeclared dependencies."
- `SKILL:129-134` "**Every contribution must be removed after the Plugin is stopped, updated, or removed.** … Use `ctx.on()` to register Event listeners. Use `ctx.effect()` to own an external subscription that returns a disposer… Do not create process-wide or page-wide side effects at module scope or outside `apply()`."
- `SKILL:240` "Use `ctx.get('slots')` and handle its absence. Then use `slots.inject` to wait for the Slot declaration and call `slots.register` inside the callback."
- `SKILL:255` "`ctx.get('slots')` does not require an injection. Do not rewrite it as `ctx.slots` unless `inject: ['slots']` is declared."
- `SKILL:265` "Do not default to root-level `root`, `sidebar`, `conversation`, or `details` Slots; replacing an entire occupant also removes the descendant Slots it declares."
- `SKILL:269` "A full settings UI should usually register its own section through **`settings.section`**… `settings.general.item` is only appropriate for one compact, general-purpose preference."
- `SKILL:306` "For toasts, status notices, and frame-wide overlays, query **`shell.overlay`** first; observe its pointer-events and ordering rules."
- `SKILL:319` "**Do not manipulate `document.body`, `window`, or hard-coded product DOM selectors.**"
- `SKILL:362-366` "Service instances, Event payloads, Slot props, Session and Conversation Snapshots… are internal live data. Do not: call `JSON.stringify` or `structuredClone` on these objects or their descendants; recursively enumerate, fully copy, or display them as a whole."
- `SKILL:386` "An unauthorized Client Package returns `awaiting-approval`."

**From `editing-cordis-compositions/SKILL.md`** (compositions/presets — mostly not your case, but one line is the install recipe):

- `SKILL:12` "**Never edit, delete, or overwrite a preset that ships with the deployment**… Reading a shipped composition is the intended way to start; writing to one is not."
- `SKILL:78` "**A row that publishes a service may not sit loose in a preset.**"
- `SKILL:129-133` the CLI form: `dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex` / `remove …`.
- `SKILL:107-118` `standingKeyFor(id)` is the mount-validation check; "**Do not treat the roster's `broken` field as validation.**"

**From the asar skill `references/ui-plugin.md`** (the ones that matter for a *statically installed* client plugin):

- "The browser artifact registers a **lazy factory whose id equals the package name**. React comes from the browser module table; no duplicate React installation, CDN script, or UMD search is needed."
- "**Keep factories free of side effects.** Register styles, timers, listeners and other resources inside `apply` with `ctx.effect`/`ctx.on` and return their cleanup functions."
- "Do not replace the app root or append a second application to `document.body`. Do not read another plugin's DOM, stylesheet, or component source to estimate placement."
- "For a simple drawing, prefer a slot with allocated space… Use `shell.overlay` only when the request needs an overlay and its placement is known."

---

## 3. Manifest contract

### 3.1 The fields that matter

`dsh.client` is validated by exactly one function, `parseDshClient`:

```js
// app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:61-75
function parseDshClient(pkgName, value) {
  if (value === void 0) return void 0;
  if (typeof value !== "object" || value === null) throw ...
  if (typeof decl.platform !== "string") throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
  const inject = optionalStringArray(pkgName, "dsh.client.inject", decl.inject);
  const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);
  if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw ...
  return { platform, inject?, external?, immediately? };
}
```

```js
// app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:715-720
if (decl === void 0 || decl.platform !== "web") { this.pkgMeta.set(sourceKey, null); return null; }   // :715  ← platform must be exactly "web"
const clientRel = clientExportOf(packageName, pkg.exports);
if (clientRel === void 0) throw new Error(`client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`);  // :720
```

| Field | Required | Verified meaning |
|---|---|---|
| `name` | ✅ | must equal the `__ModuleLoader__.load({ id })` id (§5.2) |
| `exports["./client"]` | ✅ **if `dsh.client` present** | path to the prebuilt browser bundle. String form is accepted (`clientExportOf` maps string → path). |
| `exports["."]` or `main` | ✅ | the host half's entry |
| `dsh.bundle.patch` | ✅ for auto-selection | a **file path relative to the manifest directory**, not an exports subpath. `bundlePatchPaths(dir, declared)` accepts a string or `string[]`; anything else throws `"dsh.bundle.patch must be a file path or a list of file paths"`. |
| `dsh.client.platform` | ✅ | exactly `"web"` — **also on the Electron desktop** (`app.asar:.../dsh-client-modules/lib/index.js:715`) |
| `dsh.client.inject` | optional | `string[]` of package ids forced to arrive first. `client-ui-settings-general` uses this (`.../package.json` `dsh.client.inject`) |
| `dsh.client.external` | optional | extra non-baseline module requests. "**cannot declare itself**" |
| `dsh.client.immediately` | optional | `true` puts the bundle in the eagerly prefetched tier |
| `exports["./cordis.patch.yml"]` | ❌ **not required** | whale-musume has it (`whale-musume:package.json:16`); the shipped `templates/decoration/package.json` does **not**. The patch is read off the filesystem via `dsh.bundle.patch`. |
| `peerDependencies["@deepseek-ai/dsh"]` | strongly recommended | this is the **real** compatibility gate (`evaluatePluginCompatibility`; `app.asar:.../dsh-app-boot/lib/index.js:252`). |
| `dsh.compatibility.dshReleases` | ❌ **dead field** | `grep "dshReleases"` over the whole 0.2.0-rc.2 asar → **0 matches**. whale-musume still ships it (`whale-musume:package.json:40-49`); it is inert. |

### 3.2 Minimal working manifest (copy this)

```json
{
  "name": "dsh-desktop-pet",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
  "files": ["lib", "assets", "cordis.patch.yml"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  },
  "peerDependencies": { "@deepseek-ai/dsh": "^0.2.0-rc.2" }
}
```

---

## 4. `cordis.patch.yml` — inserting the row

The profile root `cordis.yml` is an empty `[]` with a comment saying never to edit it (`desktop/cordis.yml:1-4`). Composition is: each bundle in `package.json`'s `dsh.profile.bundles`, **then** `cordis.patch.yml`, then `--patch` overlays.

### 4.1 A bundle's own patch (the normal case)

```yaml
# cordis.patch.yml  (inside your package, referenced by dsh.bundle.patch)
- insert:
    - id: dsh-desktop-pet          # Loader row id; kebab-case is the convention
      name: dsh-desktop-pet        # ESM specifier = your package name
      # config: {}                 # optional; validated against the host half's exported Config
```

Verbatim from the shipped template (`templates/decoration/cordis.patch.yml`):

```yaml
- insert:
    - id: my-decoration
      name: '@local/my-decoration'
```

Identical in shape to whale-musume (`whale-musume:cordis.patch.yml:7-9`) and to every row in `desktop/cordis.patch.yml` (which uses the *override* form `- id: <existing row>` + `name:` + `config:` — see `desktop/cordis.patch.yml:4-7` for a worked example).

Dialect notes (from `references/host-plugin.md` + `app.asar:.../dsh-base/cordis.patch.yml:28-33`):
- `!!js "<expression>"` is allowed; e.g. `disabled: !!js "!ctx.get('profileContext')"`.
- **A matching override replaces the row's whole `config`; it does not merge.**
- Row order carries no load semantics — activation is service-availability driven.

### 4.2 Is a separate "client entry" declaration needed? **No.**

There is no client row. `dsh-client-modules` scans **every Loader entry** and reads each one's `package.json`:

```js
// app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:541
for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name);   // startup full scan
```

…and each `internal/plugin` emission adds the new entry name (`:525-544`). So: **one row per package; the client half is auto-detected** from `dsh.client` + `exports["./client"]`. A "client-only" plugin is still anchored by a real host row — the template's host half is literally a no-op:

```js
// templates/decoration/index.js
export function apply() {}
```

---

## 5. Client half: naming, format, and materialization timing

### 5.1 Naming

`exports["./client"]` points at e.g. `./lib/client.js`. There is **no** name convention beyond that (`whale-musume:package.json:15` and the template both use `./client.js`). It must be a **prebuilt file on disk** — the host `readFileSync`s it at registry-construction time:

```js
// app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:614
const bundle = readFileSync(record.meta.clientPath);
// and :812
initialBundleSnapshot(pkgName, clientPath) { ... }
```

> `README.md`: "The host serves **built** client bundles, so `pnpm run build` must have produced each `lib/client.js` before launch; a missing bundle fails activation loudly with one build instruction and a package/path list."

### 5.2 Registration entry point (unchanged, and the **id must be the package name**)

Inside the bundle you must call the queue facade the host injects into `<head>`:

```js
window.__ModuleLoader__.load({ id: '<exact package name>', factory: (require) => { ... return module.exports } });
```

The bundle is rejected if it loads without registering the expected id. `require('<pkg>/client')` strips the `/client` suffix before lookup, so `id` and `name` must agree.

### 5.3 Materialization timing — **the #1 gotcha**

> `app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-modules/README.md:67`: "**Lazy-CJS model** — Executing a plugin bundle only registers its factory; every module-body side effect (CSS injection included) lives in the factory closure and runs at materialization (`factory(require)` → exports, memoized in `loadCache`)."
> `:39`: "The application combo scripts carry only each plugin's `client.js` entry and register those factories once during boot; **module bodies remain lazy and run only at first import or materialization**."

Consequence: your bundle file is **not** an ES module. Its top-level statement is the `__ModuleLoader__.load(...)` call; everything else lives inside `factory`. A top-level `document.body.appendChild(...)` outside the factory never runs (or runs once at an uncontrolled time). whale-musume states this explicitly at `whale-musume:lib/client.js:537-540`:

```js
/* 0.2.0-rc.2 的客户端模块系统是惰性 CJS：执行 bundle 只注册 factory，
   「包括 CSS 注入在内的副作用都发生在 factory 物化期」。引导因此放在
   factory 体内（物化即注入样式与脚本），apply 只负责 TTS 桥接与设置面板注册。 */
boot();
return module.exports;
```

**Recommended discipline:** factory body = pure declaration + return the plugin object; all *owned* side effects (style tags, observers, timers, listeners) go inside `apply` wrapped in `ctx.effect(...)`/`ctx.on(...)` so unload/HMR removes them (`references/ui-plugin.md`: "Keep factories free of side effects").

### 5.4 What `require` can resolve

Resolution order (`dsh-client-modules/lib/client.js:698-706`): platform seed table → memoized records → boot-graph rows → registered factories → throw.

The 0.2.0-rc.2 seed table is `PLATFORM_MODULES`:

```js
{ "react", "react/jsx-runtime", "react-dom", "react-dom/client",
  "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit" }
```

`require("react")` and `require("react/jsx-runtime")` are confirmed in use by 70+ shipped bundles (e.g. `app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-ui-approval/lib/client.js:9-10`). **No bundler, no `import`, no JSX** — write `React.createElement` or `jsx`/`jsxs` from `react/jsx-runtime` (whale-musume does the latter: `whale-musume:lib/client.js:20-23`).

> `references/practices.md`: "**Do not `require('@deepseek-ai/dsh-client-ui-primitives')`** or load any other Harness Client package as a module… they change without notice, a plain-JS plugin has no type check, and a throwing component blanks your slot entry."

---

## 6. Slot contract

### 6.1 `slots.register(options, component)` — validation, exactly

```js
// app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js
:166  if (!rec?.spec) throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`);
:173  if (occupant) throw new Error(`single slot "${options.name}" already has a registration ${occupantHint(occupant)}`);
:177  if (options.key === void 0) throw new Error(`keyed slot "${options.name}" requires options.key`);
:183  if (options.id === void 0) throw new Error(`list slot "${options.name}" requires options.id`);
:189  if (options.select === void 0) throw new Error(`chain slot "${options.name}" requires options.select`);
:81   if (childRecord?.spec !== void 0) throw new Error(`slot "${childKey}" is already declared (by ${childRecord.declaredBy ?? "an unknown entry"})`);
:194  (same rule inside register())
```

Accepted option fields: `name` (required), `key` (keyed), `id` (list), `order`, `label`, `priority`, `select` (chain), `inject`, `children`, `store`, `locale`, `registrant`.
- `label` is `string | (() => string)` — the catalog types it `SlotLabel = string | (() => string)`; "a thunk is re-read on every projection, so localized text follows the active locale without re-registering."
- `list` ordering = `priority` asc → `order` asc.
- Declaring a key in `options.children` that is **already declared** throws. Your own private child keys are fine; **do not** declare a host key to hijack it.
- The registration is owned by the caller's fiber: the renderer wraps it as `ctx.effect(() => this._register(...), "slots.register()")`, so it unwinds with your plugin.

### 6.2 `slots.inject(key, callback)`

The service signature (from the live catalog):

```
sig:    inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void
doc:    "Install an effect for each declaration lifetime of a slot. The callback runs synchronously when the
         declaration already exists; otherwise it runs inside the declaring register() call after the declaration is
         committed. Collapse disposes the effect and a later declaration runs it again. … The controller belongs to
         the caller's fiber, so plugin unload cancels a pending wait and removes any active contribution."
```

So **`slots.inject(ownerKey, () => slots.register(...))` is the correct and recommended shape** — it removes all declaration-ordering concerns. The shipped `ui-settings-general` uses `ctx.slots.inject("settings.section", () => ctx.slots.register({...}, GeneralSection))`.

### 6.3 `shell.overlay` — the correct mount point for a floating pet

From the live catalog (`app.asar:/dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js`, entry `key: "shell.overlay"`):

```
kind:        list
scope:       root
summary:     "Frame-wide floating layer, above every column and outside their scroll containers."
doc:         "…Deliberately generic and unowned by any feature… The layer itself is click-through — entries opt back
              into pointer events — so an occupant never blocks the app underneath. This is the additive seat for a
              frame-wide surface of your own: a fresh `id` is added beside the shipped entries instead of replacing them."
registerOptions: id (required), order (optional number, ascending, default 0), label (optional string | ()=>string)
ownerProps:  []
standardProps: useResource, useWorkspaces, usePanelInfo, useSessions, useSessionStatus, useSessionRetainInfo, useWorkspaces
declaredBy:  "an entry in 'root' (client-ui-layout), so it exists while that entry is mounted"
occupants:   chat.quota-notice, plugin-manager.refresh-toast, schedule.delete-toast, desktop-onboarding,
             account.platform-page, session-log-upload-toast, shortcuts, workspace.session-rename,
             workspace.session-archive, workspace.row-toast
replaceRisk: "none"
example:     ctx.slots.inject('shell.overlay', () => ctx.slots.register(
               { name: 'shell.overlay', id: 'my-entry', order: 100, label: 'My entry' },
               () => React.createElement('div', null, 'hello')))
```

Render site and the **real CSS** (`app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js`):

```js
:344  (0, react_jsx_runtime.jsx)("div", {
        className: AppFrame_module_css_default.overlayLayer,
        "data-shell-overlay": true,
        children: overlays            // = renderSlot("shell.overlay", {})
      })
:74   .BynINW_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}
      .BynINW_overlayLayer>*{pointer-events:auto}
:88   "overlayLayer": "BynINW_overlayLayer"
```

DOM you can rely on: `[data-shell-overlay]` is the layer; the renderer additionally wraps every outlet as `<div data-slot="shell.overlay" style="display:contents">`.

⚠️ **Pointer-events nuance:** the layer is `pointer-events:none`, but `.overlayLayer > *` is `pointer-events:auto` and `pointer-events` inherits — so your registered element receives pointer events by default. A full-screen pet layer must therefore set `pointer-events: none` on **its own root** and `pointer-events: auto` only on the interactive child (this is exactly what `E:\Web\deepseel mena\assets\whale-pet.css` already does with `.dwp-root`).

⚠️ The `display:contents` anchor has **no box**: `offsetWidth/offsetHeight` are always 0. Never use element size to test slot visibility.

Alternative seats (catalog-verified): `conversation.composer.dock` / `conversation.composer.bar` for in-flow decorations (the shipped template's choice), `conversation.input.overlay` for input-area overlays, `sidebar.footer.action` for small additive sidebar actions. `root` is explicitly **forbidden** by its own catalog doc: "DO NOT register here… the page would render your component alone, with every seat the frame declares gone."

### 6.4 `settings.section` — the settings panel entry

```
key:         "settings.section"
kind:        list        scope: root
summary:     "One settings page per list entry."
doc:         "…Registrant options carry the nav identity: `id` (section key, drives `only` filtering), `order` (nav
              position), `label` (registrant-localized display text…). Sections render inside the panel content column."
registerOptions: id (required), order (optional), label (optional string | ()=>string)
ownerProps:  SettingsSectionOwnerProps { close: () => void }
declaredBy:  "an entry in 'sidebar.settings' (client-ui-settings-general), so it exists while that entry is mounted"
occupants (live on THIS machine): client-ui-agent-preset 'agent-presets', client-ui-settings-account 'account',
             client-ui-settings-general 'general', client-ui-settings-models 'models',
             client-ui-settings-plugins 'plugins'
replaceRisk: "none"
```

Working registration, verbatim from whale-musume (`whale-musume:lib/client.js:509-516`):

```js
slots.inject("settings.section", () => slots.register(
  { name: "settings.section", id: "mascot", order: 6, label: "看板娘", children: { "settings.mascot.item": { kind: "list", scope: "root" } } },
  (props) => jsx(MascotSection, { ...props, ctx })
));
slots.inject("settings.mascot.item", () => slots.register(
  { name: "settings.mascot.item", id: "mascot-prefs", order: 0 },
  () => jsx(MascotPrefRows, { ctx })
));
```

The `children` declaration + `props.renderSlot("<child>", {})` pattern is the supported way to expose an extension sub-slot; `renderSlot` is only injected into a component that declared `children`. Minimal version: skip `children` entirely and render your own DOM.

Panel-open detection (do **not** iterate): `document.querySelector('[data-shortcut-modal="settings"]') !== null`; the weak secondary is `[data-slot="settings.header"]`. `[role="dialog"]` is wrong — onboarding modals use it too.

### 6.5 Client Services and Events — the verified set

`app.asar:/dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js` declares exactly these to the dynamic-client facade:

```
Services: layout, locale, sessions, slots, theme, timer, uiWorkspace, workspaces
Events:   'connection/reset'(): void
          'locale/change'(snapshot: LocaleSnapshot): void
          'slots/changed'(key: string): void
          'theme/change'(snapshot: ThemeSnapshot): void
```

Service methods (from the same catalog, selected):

```
layout      selectPanel(panelId), beginNavigation(): AbortSignal, toggleSidebar(), openRightbar(track, fullscreen), closeRightbar()
locale      getLocale(), getSnapshot(), subscribe(fn), setLocale(id), addLanguage(input), register(ns, dicts), bind(ns)
sessions    retain(target, options), using(target, options, op), retainInfo(id), refreshProjections(id),
            search(query, signal), fork(opts), scope(id), binding(id)
slots       register(...), registerFactory(...), inject(key, callback)
theme       getTheme(), setTheme(id), setFontSize(px), register(definition), overrideTokens(source, tokens)
timer       timeout(cb, delay) / timeout(delay): Promise, interval(cb, delay) / interval(delay): AsyncIterable,
            throttle(fn, delay, noTrailing?), debounce(fn, delay)
uiWorkspace openSession(target), openWorkspace(workspaceId, beforeOpen?), forkSession(id, onCreated?),
            connectWorkspace(workspaceId), startSession(workspaceId?), archiveSession(id, opts?),
            unarchiveSession(id), pickDirectory(), listDirectory(path?, signal?)
workspaces  archive/directory operations
```

**An installed (static) plugin may reach more than the dynamic facade.** Verified real `provide` calls in 0.2.0-rc.2 client bundles include `connection`, `locale`, `sessions`, `modules`, `resources`, `layout`, `theme`, `uiRenderer`, `uiSession`, `pluginNavigation`, `sidebarRight`, `sidebarRightTabs`, `documentPreviews`, `chatFileMentions`, `feedbackUi`, `userQuestionPanels`, and `timer`.

`ctx.on(event, listener)` is owned by the plugin fiber and auto-disposed. There is **no** DOM `theme/change` event — use a `MutationObserver` (§7.3) or the Cordis event.

---

## 7. Live state: how the pet knows what is happening

### 7.1 Preferred (structured, no DOM): `uiSession` / `sessions`

`app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-ui-session/lib/client.js`:

```js
:148  /** Root source combining running, pending-interaction, and completion-reminder facts. */
:149  sessionStatus = {
        getSnapshot: () => this.statusSnapshot,
        subscribe: (listener) => { this.statusListeners.add(listener); return () => { this.statusListeners.delete(listener); }; }
      };
:352  for (const id of ids) next.set(id, {
        running: this.running.get(id),
        pendingInteraction: this.pendingSnapshot.get(id),
        completionUnread: this.completionUnread.has(id)
      });
```

So `ctx.uiSession.sessionStatus.getSnapshot()` yields `Map<SessionId, { running, pendingInteraction, completionUnread }>`:
- **session is running** → `running === true`
- **an approval is pending** → `pendingInteraction !== undefined` (it is projected from `sessions` interactions; `app.asar:.../dsh-client-ui-session/lib/client.js:310-317`)
- **tool running** → not exposed here; use the DOM markers in §7.2.

Alternative, also structured: `ctx.sessions.list` is a snapshot store (`app.asar:/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js:3167` `this.list = createSnapshotStore({...})`) whose rows carry `running` (`:2279`). Shape: `{ phase, ids, byId }`, `byId[id].running`, `byId[id].retainedBy`.

Inside a React slot component the same facts arrive as **standard props**: `shell.overlay`'s `standardProps` include `useSessions: UseSessions` and `useSessionStatus: UseSessionStatus`. Their exact call signature was **not** extractable from the installed artifacts (see §12) — prefer the service form if you cannot confirm it.

### 7.2 DOM markers (exact, 0.2.0-rc.2)

| Purpose | Selector | Semantics / evidence |
|---|---|---|
| **Session running (best signal)** | `[data-chat-running]` | presence-only; mounted only while the session runs, removed when the turn ends. `app.asar:.../dsh-client-ui-chat/lib/client.js:3898-3920` (`RunningStatus`, `"data-chat-running": true`) |
| Tool running | `[data-tool][data-state="running"]`, `[data-tool][data-state="preparing"]` | `data-tool` value = **tool name**; `data-state ∈ {preparing, running, stopped, error, ok}`. `app.asar:.../dsh-client-ui-tool/lib/client.js:1716-1720`; state formula at `:273-294` |
| Tool finished OK / failed | `[data-tool][data-state="ok"]` / `="error"` | same site; note success is `"ok"`, **not** `"success"` |
| Terminal block running | `[data-terminal][data-running]` | `data-running` is an existence boolean (removed at end). `app.asar:.../dsh-client-ui-primitives/lib/index.js:9369-9373` |
| Spinner (any activity) | `[data-state="ongoing"]` | `StateDot`, an `aria-hidden` 14 px `<svg>`; cannot tell type. `.../dsh-client-ui-primitives/lib/index.js:3060-3094` |
| Reasoning streaming | `[data-variant="think"][data-state="running"]` | flips to `"ok"` when done. `app.asar:.../dsh-client-ui-chat/lib/client.js:5832-5837` |
| Assistant text streaming | `[data-streaming]`, `[data-shimmer]` | `dsh-client-ui-chat:5812,5955-5957`; `dsh-client-ui-primitives:3116-3146` |
| **Approval pending** | `[data-approval-key]` (panel root), `[data-approval-scroll]` (body) | `app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-ui-approval/lib/client.js:84` `"data-approval-key": pending.key`; `:106` `"data-approval-scroll": ""`. Composer takeover for a pending approval waterfall. |
| Generic error | `[data-tool][data-state="error"]`, `[data-state="error"]`, `[data-error]` | `dsh-client-ui-chat:6063-6075` |
| Chat seat presence | `[data-slot="conversation.chat.node"]`, `[data-conversation-region="chat"]` | count is **currently mounted nodes**, not history — do not use as a message counter |
| Current session id on the DOM | `[data-conversation-session="<id>"]` | `dsh-client-ui-conversation/lib/client.js:16333` |
| Composer | `[data-composer-card="true"]`, `[data-composer-input]` (`contenteditable`, **not** a `textarea`), `[data-input-scroll]`, `[data-composer-seat]` | `dsh-client-ui-conversation:17441-17444`, `:16565-16573`, `:16611-16631`, `:16322-16335` |
| Terminal / code body | `[data-terminal]`, `pre` | `pre` also appears inside `[data-terminal]` → de-duplicate with a `Set` when counting |
| Turn **finished** (reverse semantics!) | `[data-turn-process]` | rendered **only after** `turn.status === "closed"` — `dsh-client-ui-chat:6225-6229`. Using it as a busy signal inverts your state machine. |

### 7.3 Theme

Verified in `app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js` (`ThemePresenter`):

```js
:499  const DARK_ATTRIBUTE = "data-ds-dark-theme";
:509  const THEME_SOURCE_ATTRIBUTE = "data-ds-theme-source";
:511  const CONTENT_FONT_SIZE_VARIABLE = "--dsh-content-font-size";
:535  document.documentElement.setAttribute(THEME_SOURCE_ATTRIBUTE, snapshot.preference === "system" ? "system" : scheme);
:537  if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, ""); else body.removeAttribute(DARK_ATTRIBUTE);
```

- Dark mode = **`document.body.hasAttribute("data-ds-dark-theme")`**, value is the **empty string** (existence boolean), on **`<body>`**, never `<html>`.
- `document.documentElement.dataset.dsThemeSource ∈ {light, dark, system}`.
- There is **no** `[data-theme]`, no `html.dark`, no `body.dark` anywhere in 0.2.0-rc.2.
- Platform extras: `html[data-platform="win32|darwin|…"]`, `html[data-windows-titlebar]`, `html[data-fullscreen]`.
- CSS: write `body[data-ds-dark-theme] .dwp-thing { … }`.
- Structured alternative: `ctx.inject(['theme'], c => c.effect(() => c.theme.overrideTokens('<your-pkg>', { '--token': { light: '#…', dark: '#…' } })))` — `overrideTokens` is stack-based and "removing a layer restores whatever it covered". Or `ctx.on('theme/change', snapshot => …)`.

Confirmed `--dsw-*` tokens in real use (all from whale-musume): `--dsw-alias-border-l2`, `--dsw-alias-border-l3`, `--dsw-alias-label-secondary`, `--dsw-alias-bg-module-platform`, `--dsw-alias-interactive-bg-hover`, `--dsw-static-accent` (`whale-musume:lib/client.js:66-67,82,155,191-192,211-216`).
Additional real ones seen in shipped CSS: `--dsw-alias-state-warn-primary/-secondary/-tertiary`, `--dsw-alias-state-error-primary`, `--dsw-alias-label-primary/-tertiary`, `--dsw-specific-input-major`, `--dsw-radius-xl`, `--dsw-shadow-lv2`, `--dsw-alias-scrollbar-bg-l2`, `--dsh-chat-content-width`, `--dsh-composer-side-clearance`.

---

## 8. CSS, assets, CSP, and serving files

### 8.1 CSS injection — the HMR-safe pattern (copy this)

The compiler-generated idiom in every shipped bundle is a `<style>` tag namespaced by `data-plugin` / `data-plugin-css`. Verbatim (`app.asar:/dsh/node_modules/@deepseek-ai/dsh-client-ui-approval/lib/client.js:13-20`):

```js
const tagId = "@deepseek-ai/dsh-client-ui-approval/ApprovalPanel.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-approval";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
```

`dsh-client-modules` cleans up styles in that namespace on HMR. If you use a **different** attribute (whale-musume uses `data-dsh-whale-musume="css"`, `whale-musume:lib/client.js:29-34`) the tag will not be reaped by the module system — which is safe for a static plugin, but mirror the `data-plugin`/`data-plugin-css` form if you care about hot reload of *code*. In every case, create the tag inside `apply` and remove it from your `ctx.effect` disposer.

### 8.2 CSS you write must be namespaced

Your `<style>` is a global stylesheet in the app document. Prefix every selector with your own root class (`E:\Web\deepseel mena\assets\whale-pet.css` uses `.dwp-`). Never target host classes (they are hashed CSS-Module names, e.g. `BynINW_overlayLayer`, `j_8BDW_root`).

### 8.3 Serving images/audio/fonts: host static route

The browser document is `dsh-app://app` — a **standard, secure** custom scheme (`app.asar:/lib/main.js:11020-11030`), and the shell proxies everything that is not `/`, `/index.html`, `/assets/**`, `/favicon.svg`, `/manifest.webmanifest` to the local web server (`app.asar:/lib/main.js:11543-11551`):

```js
:6222  const SCHEME = "dsh-app";
:11543 protocol.handle(SCHEME, (request) => {
         const url = new URL(request.url);
         if (url.hostname === "shell") return serveWebDocument(request, join(app.getAppPath(), "renderer"));
         if (url.hostname === "app") {
:11547     if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/assets/") ||
               ["/favicon.svg", "/manifest.webmanifest"].includes(url.pathname))
             return serveWebDocument(request, join(resources.dsh, "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist"));
:11549     ... return forwardWebRequest(request, hostUrl, hostCookie);   // ← everything else reaches webServer
         }
         return Promise.resolve(new Response(null, { status: 404 }));
       });
```

🚫 **`/assets/**` is a dead prefix for plugin routes** — the shell's own bundled `dist` answers it and your route is never reached.
✅ Use `/api/<your-pkg>/…` (whale-musume: `/api/dsh-whale-musume/assets`, `whale-musume:lib/index.js:37`).

Host half, verbatim from whale-musume (`whale-musume:lib/index.js:31-65`) — the canonical static route:

```js
export async function apply(ctx) {
  ctx.inject(["webServer"], (wctx) => {                    // inject, not ctx.get — the fiber may not exist yet
    const dispose = wctx.webServer.register({
      kind: "exact",                                       // any value other than "exact" lands in the prefix table
      path: "/api/<pkg>/assets",
      handler: async (req, res) => { /* read f=<rel>, guard traversal, set Content-Type, pipe file */ },
    });
    wctx.effect(() => dispose, "<pkg>: static asset route");
  });
}
```

`webServer.register` rejects duplicate `(kind, path)` (`app.asar:/dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js:178-180`), handler signature is node `(req, res)`.

**In the browser half, always use a relative same-origin path** (`fetch('/api/<pkg>/assets?f=x.webp')`). The shell's `forwardWebRequest` validates `Origin: dsh-app://app`; an absolute `http://127.0.0.1:19387/...` would fail the origin check.

### 8.4 CSP

**There is no Content-Security-Policy on the application document.** `app.asar:/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html` (18 lines) has no CSP `<meta>`, and `grep "Content-Security-Policy"` over `app.asar:/lib/main.js` finds nothing. The CSPs that do exist belong to *other* windows (`/renderer/mandatory-update.html:6`, `/renderer/welcome.html:6`, `/renderer/update-dialog.html:6`, `/renderer/policy-login-loading.html:11`) and to attachment responses (`dsh-api-session-controller/lib/index.js:2342`: `"sandbox; default-src 'none'"`). So inline `<style>`/`<script>` injection and same-origin `fetch` work. Note `webSecurity: true` is set on the windows (`app.asar:/lib/main.js:6060, 7811, 9353, 9698, 10698, 11104`) — that is normal and does not block same-origin fetches.

### 8.5 Rule: never touch built-in package files

`files` in `app.asar` is read-only in practice (it is inside a signed/packed archive), and the on-disk skill forbids it (`SKILL(editing-cordis-compositions):12`). All customisation goes through your own package + `cordis.patch.yml` (row override), which survives upgrades because the user patch layer is applied last.

---

## 9. Install & verify on **this** machine

### 9.1 The real CLI path (verified)

```
C:\Users\l3561\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd
```

Its content (verbatim, 4 lines):

```bat
@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\..\..\DeepSeek Harness.exe" --expose-internals "%~dp0..\..\..\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" %*
exit /b %errorlevel%
```

Resolved, that is:

```
exe :  C:\Users\l3561\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe
cli :  C:\Users\l3561\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js
```

`dsh-desktop-host/lib/cli.js:95` calls `runCli({ manageDesktopProfile: true, packageManager: { command: process.execPath, args: ["--expose-internals", <runtime>\pnpm\bin\pnpm.mjs], env: { ELECTRON_RUN_AS_NODE: "1", DSH_DESKTOP_NODE_EXECUTABLE: process.execPath, PATH: <runtime>\bin;… } } })`.

### 9.2 Why you must use the **bundled** CLI

```js
// app.asar:/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:37
if (profile.toLowerCase() === "desktop") program.error("error: profile \"desktop\" is managed exclusively by the Electron application");
// :120   — only the plugin subcommand is exempted, and only in the Electron carrier
if (!manageDesktopProfile) rejectElectronProfile(plugin, options.profile);
```

Verified empirically: `dsh.cmd --profile desktop --dump-config-schema` → `error: profile "desktop" is managed exclusively by the Electron application` (exit 1). A generic `dsh` (`resources\runtime\cli\bin\dsh.cmd` is the desktop one; a plain `dsh` on PATH is not) cannot manage it either.

### 9.3 Commands

```powershell
$Cli = "C:\Users\l3561\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"

# install (registry name, npm alias, absolute/relative path, tarball, or git spec)
& $Cli plugin --profile desktop add <spec>
& $Cli plugin --profile desktop add "E:\Web\deepseel mena\pet-plugin"      # local directory
& $Cli plugin --profile desktop add github:Owner/repo                      # git spec

# remove
& $Cli plugin --profile desktop remove <package-name>

# list / inspect (pnpm passthrough)
& $Cli plugin --profile desktop list --depth 0
& $Cli plugin --profile desktop why <package-name>

# DSH-owned, read-only
& $Cli plugin --profile desktop version-exemptions
& $Cli plugin --profile desktop allow-version <pkg@version> --dsh-version 0.2.0-rc.2 --accept-risk
& $Cli plugin --profile desktop revoke-version <pkg@version> --dsh-version 0.2.0-rc.2
```

Equivalent explicit form (what whale-musume documents, `whale-musume:README.md:67-72`):

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
& "C:\Users\l3561\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" --expose-internals `
  "C:\Users\l3561\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add <spec>
```

**Verified live:** `& $Cli plugin --profile desktop version-exemptions` → `{}`, exit 0; `plugin --profile desktop list --depth 0` → exit 0. `SHA256` of `desktop\package.json` and `desktop\cordis.patch.yml` were identical before and after both runs (profile unmodified); a `.plugin-manager\logs\operation-*\pnpm.log` file already existed from an earlier run.

### 9.4 What `add` does to your profile (verified)

`app.asar:/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/operations.js`:

```js
:247  export async function runProfilePnpm(context, args, options) { … cwd: dir, command: <electron> args: [--expose-internals, pnpm.mjs, ...args] … }
:44   async function reconcile(before, dir, anchor, options) {
:56     const metadata = bundleManifest(name, dir, anchor);
:57     if (metadata?.dsh?.bundle === undefined) {
:58       options.onOutput?.(`dsh: warning: ${name} declares no dsh.bundle — installed as a plain dependency, not a profile layer\n`, 'stderr');
:59       continue;
:60     }
:65     if (!bundles.includes(name)) bundles.push(name);       // ← auto-appends to dsh.profile.bundles
:71     after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles } };
```

So:
- A package **with** `dsh.bundle.patch` is added to `desktop/package.json` → `dsh.profile.bundles` and its patch layer is composed. **No manual edit needed.**
- A package **without** `dsh.bundle` is installed as a plain dependency with a warning → you must add an `insert` row to `desktop/cordis.patch.yml` yourself.
- Compatibility preflight runs before pnpm for `add` with named specs; an incompatible `@deepseek-ai/dsh*` peer is refused pre-install.
- git/github/tarball specs build via `prepare`, which pnpm blocks: add the exact key to `allowBuilds` in `desktop\pnpm-workspace.yaml` and re-run.

### 9.5 Restart required? — the honest matrix

| Change | Live? | Evidence |
|---|---|---|
| Edit `desktop\cordis.patch.yml` (row insert/override/disable/config) | **live, no restart** | `dsh-hmr` is enabled by default whenever the launcher supplies `profileContext`: `app.asar:/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:28-33` → `- id: hmr / name: '@deepseek-ai/dsh-hmr' / disabled: !!js "!ctx.get('profileContext')" / config: { root: [] }`. `dsh-hmr/README.md`: "The base bundle enables HMR with `root: []` when the launcher supplies `profileContext`… `root` default `["."]`; `[]` **retains only explicit configuration watches**." `profile_manager` live confirmation: the `hmr` row is present in the enabled `@deepseek-ai/dsh-base` bundle as `include:hmr`. |
| Edit `desktop\package.json`'s `dsh.profile.bundles` | **live** (manifest is watched) | `dsh-hmr/README.md` "HMR reads the launcher's data-only `profileContext`, registers the profile **manifest** and both user patch watches during initialization"; "manifest notifications reload only when the ordered `dsh.profile.bundles` list changes." |
| Edit your plugin's **`lib/client.js`** / host `lib/index.js` while the app runs | **no** — `root: []` means module roots are *not* watched | `dsh-hmr/README.md` "To enable source-module watching, configure the `hmr` entry … `- id: hmr / disabled: false / config: { root: ["."] }`" |
| Install / replace / remove a package (`dsh plugin … add`) | **restart the app** | Plugin manager README: "**Package replacements require restarting the process to load a fresh JavaScript module generation.**" `dsh-hmr/README.md` Known Limitations: "Replacing installed package versions still requires a restart through Plugin Manager." whale-musume README: "装完**重启宿主**（桌面端重启应用）" and its FAQ: "桌面端装完**必须重启应用**". |
| First-time CLI use with no profile yet | profile must exist first | `app.asar:.../dsh/lib/plugin-BGnVfe_D.js:12`: `"Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it before running dsh plugin --profile desktop."` |

> ⚠️ `patchReload` — the key you saw in `web\package.json:11` — is a **0.1.5-rc.2** field. `grep "patchReload"` over the 0.2.0-rc.2 asar returns **0 matches**; in 0.1.5-rc.2 it appears in `dsh-app-boot/lib/index.js:331` as a per-template default (`web: "live"`, everything else `"startup"`). In 0.2.0-rc.2 the equivalent switch is the presence of `profileContext` + `dsh-hmr`'s `root` config. The desktop profile's `package.json` has **no** `patchReload` key (`desktop/package.json:1-13`) — that absence does **not** mean patches require a restart; HMR covers them.

### 9.6 Verify after install

```powershell
# structural: no restart needed for this one
& "C:\Users\l3561\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop list --depth 0
Get-Content "C:\Users\l3561\.dsh\profiles\desktop\package.json"          # your pkg now in dsh.profile.bundles
Get-ChildItem "C:\Users\l3561\.dsh\profiles\desktop\node_modules"        # your pkg materialized here
```

In the running page's DevTools console (F12):

```js
// bundle registered + your own flags
"dsh-desktop-pet" in (window.__DSH_BOOT__ ? {} : {}) || null;
document.querySelectorAll('[data-slot="shell.overlay"]').length;              // ≥ 1
document.querySelectorAll('[data-slot="shell.overlay"] .dwp-root').length;    // 1
document.querySelector('[data-shell-overlay]') !== null;                      // true
// settings entry reached the nav (open with Ctrl+, first)
document.querySelector('[data-shortcut-modal="settings"]') !== null;          // true when open
[...document.querySelectorAll('[data-shortcut-modal="settings"] nav button')].map(b => b.textContent.trim());
// live signals
({ chatRunning: !!document.querySelector('[data-chat-running]'),
   tools: [...document.querySelectorAll('[data-tool]')].map(n => n.getAttribute('data-tool') + ':' + n.getAttribute('data-state')),
   terminal: document.querySelectorAll('[data-terminal][data-running]').length,
   approval: document.querySelectorAll('[data-approval-key]').length,
   dark: document.body.hasAttribute('data-ds-dark-theme'),
   themeSource: document.documentElement.dataset.dsThemeSource });
```

For whale-musume the equivalent probes are `window.__dshWhaleMusumeBooted === true` and `document.querySelectorAll('[data-dsh-whale-root]').length === 1` (`whale-musume:README.md:76-83`).

**Client Inspect Providers** (`cordis_inspect_query` with `platform: "client"`) are the sanctioned API-discovery route (`SKILL(cordis-plugin-development):12-13`), but on this machine every client query returned `timed out after 10000ms` / "Open or reconnect the Harness page, then retry" (§12). Use the DevTools console probes above instead.

---

## 10. Gotchas that break a naive attempt

1. **Module materialization timing.** Your `client.js` is a bundle, not an ES module: the file's only top-level statement is `window.__ModuleLoader__.load({ id, factory })`. Any top-level side effect outside `factory` runs at an uncontrolled time; anything you want at load must be inside `factory`, and all *owned* effects belong in `apply` via `ctx.effect`/`ctx.on` (§5.3).
2. **`id` must equal the package name.** `require("<pkg>/client")` strips `/client` before the lookup; a mismatched `id` makes the bundle "loaded without registering" and the whole combination throws.
3. **`dsh.client.platform` must be exactly `"web"`** — also on the Electron desktop. `"desktop"`, `"electron"`, `undefined` → the package is silently demoted to non-client (`.../dsh-client-modules/lib/index.js:715`).
4. **No bundler, no JSX, no `import`, no `require` of arbitrary packages.** Only the platform seed table + registered package factories resolve. `React.createElement` or `require("react/jsx-runtime")`; `require("@deepseek-ai/dsh-client-ui-primitives")` is explicitly discouraged.
5. **CSS injection is not disposed for you.** Use `data-plugin` / `data-plugin-css` (module-system namespace) or your own attribute, and remove the tag in your `ctx.effect` disposer.
6. **`/assets/**` never reaches your host route** on the desktop (`app.asar:/lib/main.js:11547`). Use `/api/<pkg>/…`, and fetch it with a **relative** URL so the shell's `Origin: dsh-app://app` check passes.
7. **`shell.overlay` is click-through by design, and `.overlayLayer > *` re-enables pointer events.** A naive full-screen overlay swallows every click in the app. Set `pointer-events: none` on your root and `pointer-events: auto` only on interactive children.
8. **The slot outlet anchor is `display: contents`** — `offsetWidth`/`offsetHeight` are 0. Never size-test a slot.
9. **`list` slots require `id`; reusing an existing `id` *replaces* that occupant; declaring an already-declared child key throws.** `single` slots throw on a second registration. `replaceRisk: "shadows-shipped-ui"` on e.g. `settings.trigger`, `conversation.approval.detail`.
10. **`root` is not a mount point.** Its own catalog doc: registering there replaces the whole AppFrame and every seat it declares.
11. **`[role="dialog"]` is not the settings panel.** Onboarding/login/shortcut dialogs use it too. The only reliable marker is `[data-shortcut-modal="settings"]`.
12. **`[data-turn-process]` means the turn *finished*.** Busy-state logic that greps for "process" inverts.
13. **`[data-status="running"|"success"]`, `[data-role="tool"]`, `[data-tool-card]`, `[data-theme]`, `[data-slot="terminal"]`, `[class*="stream" i]` are all dead** in 0.2.0-rc.2 (hashed CSS-Module class names replaced the old text-matched classes).
14. **Config is replaced, not merged.** A patch row that matches an `id` replaces the whole `config` object — restate every key you still want (this is exactly why `desktop/cordis.patch.yml:11-16` restates the entire provider map).
15. **`dsh.compatibility.dshReleases` is inert.** The gate is `peerDependencies` against `@deepseek-ai/dsh*`, with per-pair exemptions in `profiles\<name>\compatibility.json`.
16. **Adding a package requires an app restart** to get a fresh JS module generation; editing the patch/config does not.
17. **git/github specs need build-script approval.** pnpm blocks `prepare`; the CLI tells you to add the exact key under `allowBuilds` in `profiles\desktop\pnpm-workspace.yaml` and re-run.
18. **Do not edit built-in packages or bundled presets.** Use a row override in the profile patch layer, which is applied last and survives upgrades.
19. **Do not `JSON.stringify` live DSH objects** (snapshots, props, services) — read leaf scalars only.
20. **Profiles are shared state.** `desktop` is one profile for the whole app; an install affects every session.

---

## 11. Minimal complete skeleton

A complete, installable client-side pet plugin. Five files in `E:\Web\deepseel mena\pet-plugin\`.

### 11.1 `package.json`

```json
{
  "name": "dsh-desktop-pet",
  "version": "0.1.0",
  "private": true,
  "description": "Floating desktop-pet overlay for DeepSeek Harness",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
  "files": ["lib", "cordis.patch.yml"],
  "peerDependencies": { "@deepseek-ai/dsh": "^0.2.0-rc.2" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  }
}
```

### 11.2 `cordis.patch.yml`

```yaml
# Bundle layer, applied over the empty profile root. The client half is picked up
# automatically: dsh-client-modules scans every Loader entry's package.json.
- insert:
    - id: dsh-desktop-pet
      name: dsh-desktop-pet
```

### 11.3 `lib/index.js` — host half (static asset route)

```js
// Host half: serve the package's own assets over an /api/ route.
// NOTE: never use an "/assets/..." path — the Electron shell answers that prefix
// from its bundled dist and the request never reaches webServer.
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-desktop-pet';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function safeResolve(rel) {
  const target = path.normalize(path.join(ROOT, rel));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

export function apply(ctx) {
  // inject(), not ctx.get(): the webServer fiber may not exist yet when apply runs.
  ctx.inject(['webServer'], (wctx) => {
    const dispose = wctx.webServer.register({
      kind: 'exact',
      path: '/api/dsh-desktop-pet/assets',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const file = safeResolve((url.searchParams.get('f') ?? '').split('?')[0]);
        if (file === null || !existsSync(file) || !statSync(file).isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Cache-Control': 'public, max-age=3600',
        });
        createReadStream(file).pipe(res);
      },
    });
    wctx.effect(() => dispose, 'dsh-desktop-pet: asset route');
  });
}
```

### 11.4 `lib/client.js` — the client half (the important file)

```js
// Client half. Lazy-CJS bundle: the ONLY top-level statement is __ModuleLoader__.load.
// `id` must equal package.json "name". No import / no JSX / no bundler.
window.__ModuleLoader__.load({
  id: 'dsh-desktop-pet',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PKG = 'dsh-desktop-pet';
    const ASSET = '/api/dsh-desktop-pet/assets?f=';   // relative: same origin (dsh-app://app)
    const CSS_TAG = PKG + '/pet.css';

    const CSS = `
.dwp-root{position:fixed;inset:0;z-index:2147482000;pointer-events:none;
  font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  --dwp-fg:var(--dsw-alias-label-primary,#16324a);
  --dwp-sub:var(--dsw-alias-label-secondary,#5b7891);
  --dwp-bg:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.92));
  --dwp-line:var(--dsw-alias-border-l2,rgba(22,50,74,.14));}
.dwp-stage{position:absolute;right:24px;bottom:24px;width:200px;height:220px;
  pointer-events:auto;        /* only the sprite is interactive */
  border:1px solid var(--dwp-line);border-radius:16px;
  background:var(--dwp-bg);color:var(--dwp-fg);
  display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
  box-shadow:var(--dsw-shadow-lv2,0 6px 24px rgba(0,0,0,.16));
  transition:transform 160ms ease;user-select:none;cursor:grab;}
.dwp-stage[data-busy="1"]{transform:translateY(-4px);}
.dwp-eye{font-size:44px;line-height:1;}
.dwp-cap{font-size:11px;color:var(--dwp-sub);padding:4px 8px 8px;text-align:center;}
body[data-ds-dark-theme] .dwp-stage{--dwp-bg:rgba(28,32,38,.92);}`;

    function installCss() {
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']') !== null) return null;
      const tag = document.createElement('style');
      tag.dataset.plugin = PKG;
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => { tag.remove(); };
    }

    /* ---- live signals: pure DOM reads, no host objects cross this boundary ---- */
    const SIGNAL_SELECTORS = {
      sessionRunning: '[data-chat-running]',
      toolRunning: '[data-tool][data-state="running"],[data-tool][data-state="preparing"]',
      terminalRunning: '[data-terminal][data-running]',
      approvalPending: '[data-approval-key]',
      thinking: '[data-variant="think"][data-state="running"]',
    };
    function readSignals() {
      const out = {};
      for (const key of Object.keys(SIGNAL_SELECTORS)) {
        out[key] = document.querySelector(SIGNAL_SELECTORS[key]) !== null;
      }
      const last = document.querySelectorAll('[data-tool]');
      const tail = last.length > 0 ? last[last.length - 1] : null;
      out.toolName = tail === null ? '' : (tail.getAttribute('data-tool') || '');
      out.dark = document.body.hasAttribute('data-ds-dark-theme');
      out.sessionId = document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') || '';
      return out;
    }

    /* ---- overlay: registered into the frame-wide list slot shell.overlay ---- */
    function Overlay() {
      const [sig, setSig] = React.useState(readSignals);
      React.useEffect(() => {
        let queued = false;
        const flush = () => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => { queued = false; setSig(readSignals()); });
        };
        const observer = new MutationObserver(flush);
        observer.observe(document.body, {
          subtree: true, childList: true,
          attributes: true,
          attributeFilter: ['data-chat-running', 'data-tool', 'data-state', 'data-running', 'data-approval-key', 'data-ds-dark-theme', 'data-conversation-session'],
        });
        flush();
        return () => observer.disconnect();
      }, []);

      const busy = sig.sessionRunning || sig.toolRunning || sig.terminalRunning;
      const mood = sig.approvalPending ? '🙋 waiting for you'
        : sig.terminalRunning ? '🖥️ terminal'
        : sig.toolRunning ? '🔧 ' + (sig.toolName || 'tool')
        : sig.thinking ? '🤔 thinking'
        : sig.sessionRunning ? '✍️ writing'
        : '😴 idle';

      return h('div', { className: 'dwp-root' },
        h('div', { className: 'dwp-stage', 'data-busy': busy ? '1' : '0', title: mood },
          h('div', { className: 'dwp-eye' }, sig.dark ? '🐋' : '🐳'),
          h('div', { className: 'dwp-cap' }, mood)));
    }

    /* ---- settings panel: one page in the settings nav ---- */
    const PREF_KEY = 'dsh-desktop-pet:enabled';
    function readPref() {
      try { return window.localStorage.getItem(PREF_KEY) !== '0'; } catch { return true; }
    }
    function SettingsSection() {
      const [on, setOn] = React.useState(readPref);
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' } },
        h('label', {
          style: { alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l2)', display: 'flex', gap: '12px', justifyContent: 'space-between', padding: '10px 0' },
        },
          h('span', null, 'Show the pet'),
          h('button', {
            type: 'button', role: 'switch', 'aria-checked': on,
            onClick: () => {
              const next = !on;
              try { window.localStorage.setItem(PREF_KEY, next ? '1' : '0'); } catch {}
              setOn(next);
              window.dispatchEvent(new CustomEvent('dsh-desktop-pet:pref', { detail: { key: 'enabled', value: next } }));
            },
          }, on ? 'On' : 'Off')),
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
          'Floats above every column. Only the sprite accepts clicks.'));
    }

    function PetMounted() {
      const [on, setOn] = React.useState(readPref);
      React.useEffect(() => {
        const sync = () => setOn(readPref());
        window.addEventListener('dsh-desktop-pet:pref', sync);
        window.addEventListener('storage', sync);
        return () => {
          window.removeEventListener('dsh-desktop-pet:pref', sync);
          window.removeEventListener('storage', sync);
        };
      }, []);
      if (!on) return null;
      return h(Overlay, null);
    }

    return {
      inject: ['slots'],           // hard dependency: the plugin waits for the slots service
      apply(ctx) {
        // 1. styles are an owned effect
        ctx.effect(() => installCss(), PKG + ': styles');

        // 2. floating overlay — additive, replaceRisk none, exists for the whole app lifetime
        ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: PKG, order: 1000 },
          PetMounted,
        ));

        // 3. settings page — appears in the settings nav while the panel shell is mounted
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          { name: 'settings.section', id: 'pet', order: 50, label: 'Desktop pet' },
          SettingsSection,
        ));

        // 4. second live signal source: Cordis events (auto-disposed with the fiber)
        ctx.on('theme/change', () => { /* React state above re-reads via MutationObserver */ });
        ctx.on('connection/reset', () => { /* optional: reset animation state */ });
      },
    };
  },
});
```

> Optional, if you want assets instead of emoji: `fetch(ASSET + 'pet.webp')` from inside `apply`/the component (relative URL, `dsh-app://app` origin), plus `export function apply` in the host half as shown. Audio and fonts work the same way.

### 11.5 Install it

```powershell
$Cli = "C:\Users\l3561\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $Cli plugin --profile desktop add "E:\Web\deepseel mena\pet-plugin"
# then FULLY QUIT and relaunch "DeepSeek Harness" (new JS module generation)
```

Then open `Ctrl+,` → the section **Desktop pet** should be in the nav, and `[data-shell-overlay] .dwp-stage` should exist. Follow-up edits to `lib/*.js` also need a full app restart; edits to `cordis.patch.yml` alone are hot-reloaded.

---

## 12. What I could **not** verify (no guessing)

1. **Client Inspect Providers are unreachable right now.** All five `cordis_inspect_query(platform: "client")` calls (`Service.listService`, `Event.listEvents`, `Builtin.listBuiltins`, and the `Slots`/`Theme` providers) returned `timed out after 10000ms… Open or reconnect the Harness page, then retry`. Every Service/Event/Slot fact above is therefore sourced from the 0.2.0-rc.2 asar **catalog text and shipped code**, not from a live provider response. Server-side `plugin_manager` queries did work.
2. **Exact signatures of the slot standard-prop hooks** (`UseSessionStatus`, `UseSessions`, `UseResource`, `UsePanelInfo`, `UseSessionRetainInfo`, `UseChat`, `UseConversation`, `UseInput`, `UseProjection`, `UseTrajectory`) — the catalog lists them by name and type alias only; the type declarations are not in the shipped `lib/client.js` I searched. I did **not** verify whether `useSessionStatus` is a `(selector) => value` hook or anything else. Use `ctx.uiSession.sessionStatus` / `ctx.sessions.list` instead.
3. **`uiSession.sessionStatus` and `sessions.list` were read from bundle source, not exercised at runtime.** The field names (`running`, `pendingInteraction`, `completionUnread`) and the `Map` shape are literal from `dsh-client-ui-session/lib/client.js:148-152, 352-356`; I did not observe a live approval to confirm `pendingInteraction`'s value shape.
4. **The `data-approval-key` marker was not observed in a live DOM** — only in source (`dsh-client-ui-approval/lib/client.js:84`). Its lifetime ("one pending approval waterfall per composer takeover") is inferred from the component's doc comment.
5. **Whether `shell.overlay`'s `data-slot` anchor is *always* present.** ui-layout renders `renderSlot("shell.overlay", {})` unconditionally (`dsh-client-ui-layout/lib/client.js:340-346`), but this is static reading, not a DOM observation.
6. **Whether `dsh.client.inject` fails when the named package is absent from the composition.** I did not test it, and I deliberately left it out of the skeleton for that reason. `client-modules/README.md` describes composition rejection for malformed `external` requests; the `inject` failure mode is not documented in the installed artifacts.
7. **HMR's exact behaviour for a newly installed package.** The docs say "Installing a new bundle can activate through HMR" (`references/host-plugin.md`) but also "Replacing installed package versions still requires a restart". I did not install anything (the brief forbids modifying state), so the border between "new" and "replaced" is documented, not measured.
8. **`dsh plugin --profile desktop add` while the app is running.** I only ran the read-only `version-exemptions` and `list` subcommands. The CLI's own error text (`plugin-BGnVfe_D.js:12`) advises fully quitting; whether `add` succeeds against a live profile (lock contention aside) is untested.
9. **The `dsh-desktop-pet` Electron overlay path** (`research\dsh-desktop-pet\src\main.cjs`, `shared.cjs`) — I read it fully, but its HTTP contract (`/whale-girl/state`, `/whale-girl/events`, `/whale-girl/sessions`, `/whale-girl/presence`, `/whale-girl/interact`, `apiVersion: 1`, `activity.sessionThink/sessionWait/turnCompletedUntil`) belongs to a **different upstream plugin** that must register those routes; none of it exists in this profile. Its window recipe is verified as *code*: `BrowserWindow({ transparent: true, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })` (`main.cjs:77-96`), IPC channels `pet:get-bootstrap|get-manifest|get-config|get-sessions|refresh|interact`, `pet:set-click-through`, `pet:drag-start|drag-move|drag-end`, `pet:walk-move`, `pet:quit`, plus `send('pet:snapshot'|'pet:connection')`. It was **not** run.
10. **whale-musume's desktop-profile claims about the author's machine** — `docs/desktop-0.2.0-rc.2-contract.md:64-74` describes `D:\DeepseekHarness_Data\.dsh` and a different bundle list. I re-verified every selector/attribute I quote from it against **this** asar; I did not verify its install path, its `compatibility.json` claim for that machine, or its `[data-slot="settings.trigger"]` reasoning end-to-end (the underlying `settings-account` registration is present here — `plugin_manager list_bundles` shows `ui-settings-account` enabled in `dsh-web-app`).
11. **Two skill sets with the same names exist** (§2). I could not determine which one your session's loader was reading when it reported the failure; I only established that the on-disk copies lack `references/` and `templates/`, and that the asar copies cannot be opened by shell/rg/node tooling.

---

*All local facts above are reproducible with [`tools/asar-read.mjs`](../tools/asar-read.mjs) (`find` / `cat` / `grep`) against `C:\Users\l3561\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`, plus the on-disk profile files and `resources\runtime\cli\bin\dsh.cmd`. No file outside this document and `tools\asar-read.mjs` was created or modified by this research apart from the GitHub downloads already present under `research\`.*
