# Photon host changes for device sign-in

This note is for the Photon team. It describes host changes that Photon AI Studio needs for Codex and Grok device sign-in.

Photon Studio 0.1.41 (`@tenzen/photon`) cannot finish that flow. A local test install of the editor was modified so the plugin could be tried. The plugin package does not contain those edits. Please implement the behavior in Photon and in `@photon/plugin-sdk`.

The local test build changed three files inside `resources/app.asar`:

- `dist-electron/electron/plugins/controller.js`
- `dist/assets/PhotonNativePanel-D_o_1O-3.js`
- `dist/assets/PluginManager-Dru6GY4k.css`

The installed `app.asar.bak` is the original 0.1.42 archive. Electron keeps the archive mapped until Photon Studio is fully quit and opened again.

## What stock 0.1.41–0.1.42 does

Device sign-in needs four host behaviors that 0.1.41 does not provide.

1. OpenAI and xAI token endpoints require `Content-Type: application/x-www-form-urlencoded`. `NetworkRequest` can send `json` or `multipart` only. A multipart token exchange is rejected after the user approves, so the dialog stays on "Waiting for approval…".
2. `ui.dialog` opens one modal and resolves on the first button. A second call throws `Close the current plugin dialog first.` Sending a new dialog through `DialogHost` unmounts the current one, and its cleanup resolves the first promise with `null`. The plugin treats that as Cancel, so the button label cannot change from "Open browser" to "Continue" while the same dialog stays open.
3. A native Photon panel is rendered by the editor. The plugin page is a hidden `WebContentsView` (`setVisible(false)` at creation, and again while `ui` is `native`). With `backgroundThrottling: true`, Chromium freezes timers in that page. The approval poll never runs, so a successful login is never observed.
4. `shell.open` and `clipboard.write` exist for other plugin families. A Photon plugin reaches `Photon plugins must use the SDK capabilities.` before those methods (`controller.js`, `guest()`). The plugin page also has no `window.photon.openExternal`, and `setWindowOpenHandler` denies `window.open`. Copy and "Open browser" have to run in the editor dialog.

OAuth requests also omit `jobId`. `network()` throws `Plugin job is closed.` when `jobId` is set and that job is not in the live job map. Device sign-in is not a `jobs.run` job. That check was left as it is.

## 1. Form request bodies

In `controller.js`, `network()` accepts `p.form` after the multipart branch and before `fetch`:

- Reject the request when a body is already set, when `form` is missing, or when `form` is an array.
- Accept only string values. Reject any other field type.
- Encode with `URLSearchParams` and set `Content-Type` to `application/x-www-form-urlencoded`.

The same size, origin, redirect, and credential checks still apply. `form` is mutually exclusive with `json` and `multipart`.

Suggested SDK addition on `NetworkRequest`:

```text
form?: Record<string, string>
```

The plugin already sends `form` for these calls:

- `POST https://auth.x.ai/oauth2/device/code` with `client_id` and `scope`
- `POST` to the xAI token endpoint with `client_id`, `device_code`, and `grant_type` `urn:ietf:params:oauth:grant-type:device_code`
- `POST https://auth.openai.com/oauth/token` with `grant_type` `authorization_code`, `code`, `code_verifier`, `redirect_uri`, and `client_id`
- Refresh calls to the same token endpoints with `grant_type` `refresh_token`

Codex device start and Codex device poll stay JSON. xAI answers `authorization_pending`, `slow_down`, `access_denied`, and `expired_token`. Codex poll uses HTTP 403 and 404 while the user has not approved yet.

## 2. Update an open native dialog

In `controller.js`, `request()` handles `ui.dialog` like this when `p.update` is set:

- Validate the panel model.
- If a dialog is open, send `plugins:panel-state` again with the same `sdkDialog.id`, the new model, and `update: true`.
- Return `null`. Do not replace `s.dialog` and do not resolve the original promise.
- If no dialog is open, return `null` and do not open one.

The patched `PhotonNativePanel` bundle keeps the mounted dialog in a `dialogWatch` map. A later `sdkDialog` for the same instance calls `setState` on that dialog. It does not call `DialogHost` again, so the original finish callback stays in place. The first resolving button, or unmount, still settles the original `ui.dialog` promise.

The plugin reaches this through the runtime bridge, because public `api.ui.dialog` has no update argument:

```text
__photonPlugin.request("sdk.ui.dialog", { model, update: true })
```

A public method is the right fix. One shape that matches the plugin:

```text
const dialog = api.ui.dialog(model)
dialog.result   // Promise<UiEvent | null>, as today
dialog.update(model)  // replace the open model; do not resolve result
```

`update` after the dialog has closed should resolve without throwing.

## 3. Dialog actions that leave the dialog open

The local editor patch is a sign-in workaround. It special-cases control ids. Please replace it with general control actions. Every plugin dialog should not grow a hidden dependency on the ids `copy`, `open`, `code`, and `codeRow`.

What the test build does in the `PhotonNativePanel` bundle:

- A group whose id is `codeRow` uses the class `photon-native-inline` (a horizontal row).
- A button whose id is `copy` is a borderless 16px clipboard glyph with accessible name "Copy to clipboard". It does not resolve the dialog.
- On first mount, if any control id is `copy`, the input value `code` is copied once. The browser is not opened.
- A button whose id is `open` reads the first top-level `text` control whose text starts with `https://` and calls `window.photon.openExternal`. It does not resolve the dialog.
- Any other button resolves the dialog and closes it, which is the 0.1.41 behavior.
- An empty label is not rendered, so the code field has no extra caption.

`PluginManager-Dru6GY4k.css` adds `.photon-native-inline` and `.photon-copy-glyph`. The glyph uses `--ph-muted` and `--ph-text`.

The dialog the plugin sends today:

- group `codeRow`: input `code` (the user code, empty label) and button `copy`
- text: "Waiting for approval…", "Signed in.", or a danger-tone error
- text: the verification URL
- primary button `open` ("Open browser") until approval, then primary button `continue` ("Continue")
- button `cancel` ("Cancel")

Copy runs when the dialog opens. "Open browser" runs only after that button is clicked. Continue and Cancel close the dialog. Escape still returns `null`.

A durable API can express the same flow without reserved ids. For example, a button can declare an action that does not resolve the dialog:

```text
{ type: "button", id: "copy", action: "copy", target: "code" }
{ type: "button", id: "open", action: "openExternal", target: "verificationUrl" }
{ type: "text", id: "verificationUrl", text: "https://..." }
```

`copy` copies the target control's current value in the editor process. `openExternal` allows only `https:` URLs. Both leave the dialog open. The editor can also copy once when the dialog opens if the model asks for that.

## 4. Keep timers running in a hidden plugin page

In `controller.js`, the plugin `WebContentsView` is created with `backgroundThrottling: false`, and `view.webContents.setBackgroundThrottling(false)` is called immediately after construction.

Native Photon UI keeps that view hidden. The OAuth loop uses timers in the plugin page. With throttling left on, the page never wakes up to see `authorization_pending` clear, and the dialog cannot advance.

Please keep timers alive for a Photon plugin runtime that is hidden because its UI is native. The view can stay invisible.

## 5. Attach an OAuth bearer token

`network()` still rejects an `Authorization` header set by the plugin. Device sign-in receives a bearer token that is not an API key in the password vault. Image calls and model-list calls need that token on later requests.

The plugin sends it as `authorization: "Bearer <token>"` on the network request, separate from `headers`. In `network()`, after the credential block and before the body is built:

- Accept only a string that starts with `Bearer`.
- Reject newlines and values longer than 16 KB.
- Set `headers.Authorization` from that field.

Plugin-set `Authorization`, `cookie`, and API-key headers stay rejected. API keys continue to use a credential reference.

## 6. Remember a device sign-in

`credentials.configure` is the password dialog, and `credentials.status` never returns the saved secret. The plugin cannot put the device-sign-in token back into that slot, and it must not write the token into plugin settings.

Add two host methods that use the same encrypted credential file:

- `credentials.store({id, origin, value})` saves a session string for an origin the plugin already declares. Mark the record `session: true`. Allow up to 64 KB. Do not open a dialog.
- `credentials.read({id})` returns the decrypted string only when that record is a session. Password-dialog API keys stay unreadable.
- `credentials.delete` already removes either record.

The plugin stores `codex-session` for `https://chatgpt.com` and `grok-session` for `https://api.x.ai`. The JSON contains the access token, refresh token, expiry, account id, and token endpoint. On the next launch the plugin reads that record, refreshes it when it is near expiry, and loads the model list. Forget Login deletes the record.

## Still limited

The vault can attach `Authorization`, `x-api-key`, `x-goog-api-key`, and `x-key`. Ideogram's published header is `Api-Key`. The plugin sends the vault key as `x-api-key` because that is a header the host already allows.

On 2026-10-05, the installed 0.1.42 `app.asar` contained `credentials.read` and `credentials.store`; its original `app.asar.bak` did not. After the development folder was reloaded, the registry no longer recorded a `credentials.read` error. The public SDK package still lacks typed methods for these calls, so the plugin uses its bridge. A `credentials.read` error on a running editor means its loaded controller lacks this host patch; fully quit and reopen Photon after replacing an archive.

## What to ship

Ship these behaviors in Photon and the SDK: `form` bodies, an in-place dialog update, dialog actions for copy and open-external that do not close the dialog, unthrottled timers for a hidden native plugin runtime, an `authorization` field on network requests, and encrypted session store/read.

Photon Studio 0.1.42 and stock 0.1.47 still need all of them. Leave the sign-in control ids and the CSS class names as plugin details. A local test install may carry those edits until the product does.

## Photon Studio 0.1.47

The 0.1.47 updater replaces `resources/app.asar` with an unpatched archive. Stock 0.1.47 still throws `Unsupported Photon SDK capability` for `config.get`, `config.set`, `ui.customDialog`, `credentials.store`, `credentials.read`, `form` bodies, and a plugin-supplied `authorization` field. Custom `ui: "custom"` panels remain valid.

On a fresh 0.1.47 install the plugin used to fail activation on `config.get` and never sent `sdk.ready`, so Photon reported that it did not finish activation and the AI panel stayed empty. The plugin now continues without those methods: Library metadata falls back to `settings.json`, Library/Templates open inside the docked panel, and an OAuth session is kept only in memory. The host work in this note is still required for device sign-in, remembered Codex/Grok sessions, separate 1 MB Library files, and an editor-owned Library modal.

## Library and Templates host work

The earlier `sdk.ui.customDialog({open})` patch enlarged the plugin's
`WebContentsView` to the entire editor. That made Library and Templates appear
to sit inside a full-screen panel. The replacement must create a separate
Electron modal `BrowserWindow` owned by the editor window. Its content is the
same plugin-owned `WebContentsView`, temporarily reparented from the dock. The
host captures the panel before moving that view and shows the capture in a
temporary dock view. The panel controls remain visible behind the modal; the
modal naturally prevents interaction with them until it closes. The live
panel's normal bounds and visibility are restored when the modal closes.

Patch `resources/app.asar` → `dist-electron/electron/plugins/controller.js` in
`PhotonRuntime.request()`. Accept `sdk.ui.customDialog({open: true})` only from
a declared custom Photon panel. Create a frameless, resizable child window with
`parent` set to the editor and `modal: true`, then move the plugin view into it.
Before moving the view, capture its panel pixels, create a temporary
`WebContentsView` with that image, and place it at the panel bounds. Keep the
modal hidden until `sdk.ui.customDialog({ready: true})` arrives, after the
plugin has rendered the dialog. The plugin hides its panel content only in the
moved live view. `sdk.ui.customDialog({open: false})` closes the window,
removes the temporary dock view, and restores the live view to its owner.
Closing the window by the OS does the same and sends `customDialogClosed` so
the plugin clears its modal state.
The host must preserve the plugin's broker, theme, session, and web-navigation
restrictions. The nested Edit and field dialogs remain inside the same modal
window; they do not open more host windows.

The same controller file also needs changes in plugin stop, panel bounds,
visibility, and detach handling. Stop must close an open modal and remove the
temporary dock view before destroying the live view. Bounds updates must size
the live view to the modal and keep the temporary dock view at the panel bounds;
panel hide and detach events must not hide an active modal. Detached panel
owner changes must move the temporary dock view while leaving the live view in
the modal until it closes. No hashed renderer asset changes for this behavior.

`scripts/photon-modal-dialog-source.mjs` contains these exact controller edits.
`scripts/patch-photon-host.mjs` stages them in a copy of an existing archive;
it also adds the plugin-config bridge if absent. Use the installed archive
containing the earlier sign-in changes as input, not stock `app.asar.bak`.
Close every Photon Studio process before replacing `app.asar`, preserve the
old archive, and reopen Photon. The public Photon SDK still needs a supported
custom-dialog API so plugins need no private bridge or local ASAR edit.

## Requested Photon feature expansion: per-plugin configuration files

**Photon team: please add first-class per-plugin configuration files to the host and public SDK.** A plugin needs named, private JSON stores alongside `settings.json`, so larger independent collections do not compete for one 1 MB settings file. This is a request for a supported Photon capability, not a claim that stock Photon Studio 0.1.42 provides it. The local `app.asar` patch below only lets this plugin use the proposed API during development.

The requested SDK surface is `api.config.get<T>(id)` and `api.config.set(id, value)`. Photon should resolve each file inside the calling plugin's private data directory, accept a bounded ID rather than a path, apply an explicit size limit per file, write atomically, and remove the files with that plugin's data. A missing file should return an empty object. The plugin must not gain access to another plugin's files. These methods should be typed and documented in `@photon/plugin-sdk` so plugins do not need to call the private bridge.

Main `settings.json` should hold only provider preferences and model cache. The thirty shipped presets come from `config/premade-templates.json` in the plugin package. Editable prompts and their replay metadata, History metadata, templates and their references, folders, deletion state, and ordering belong in `config-library.json`; deduplicated saved prompt and History reference image data belongs in `config-references.json` under Photon's existing private directory for the plugin. The plugin copies an older Library from `settings.json` into this file before replacing settings without the Library field. A failed first write leaves the old settings copy intact for retry.

Photon Studio 0.1.42 has `this.persistent(i, name)`, `this.json(i, name)`, `this.save(i, name, value)`, and `this.exclusive(i, callback)` in `resources/app.asar` → `dist-electron/electron/plugins/controller.js`. The JSON helper returns `{}` for a missing file and limits each file to 1 MB; save writes a temporary file and renames it. The local qualification patch adds two requests in `PhotonRuntime.request()` before the `settings.get` case:

- `config.get({id})` reads `config-<id>.json` through `this.json`.
- `config.set({id, value})` accepts a plain JSON object and writes it through `this.exclusive` and `this.save`.

Use the plugin's existing `i.plugin.key` through `this.persistent`; never accept a path from the plugin. The local qualification patch allows only `library`, `templates`, `history`, and `references` as IDs, giving at most four 1 MB files per plugin. These files are private to that plugin and are removed by the existing per-plugin data cleanup. The plugin now uses `library` for saved prompt and History replay metadata and `references` for their deduplicated image snapshots. Photon can choose the final quota and naming policy, but should expose and document them in the public API. The current plugin calls the bridge because the vendored SDK has no config methods. Picker-granted `files.read/write` cannot serve as automatic private config storage.

Two limits remain for a production-quality collection:

1. Add a public modal-dialog method to `@photon/plugin-sdk` when shipping the host change. The current plugin uses the private `ui.customDialog` bridge because the vendored SDK has no such method.
2. The new Library config file still has a 1 MB limit. To keep full-resolution reference files, add plugin-scoped binary storage in the same controller and SDK. A safe shape is `storage.write(id, bytes)`, `storage.read(id)`, and `storage.delete(id)` with path-free, plugin-scoped IDs, a total per-plugin quota, atomic writes, and cleanup on uninstall. Keep Library metadata in its separate config file, migrate image bytes into binary storage, and stop pruning history once it has its own bounded or paged store. The current plugin stores resized references and bounded history in `config-library.json`; it does not call a binary API that stock Photon lacks.

For the product release, rebuild `app.asar` from Photon source instead of string-patching a hashed renderer bundle. The local migration below is a guarded bridge for users of the patched development installation. Quit all Photon Studio processes before archive replacement and relaunch to load the result.

## Moving a local installation to Photon Studio 0.1.43

`scripts/migrate-photon-asar.mjs` carries the reviewed 0.1.42 local changes in the controller, native panel bundle, and panel stylesheet to an **unpatched** 0.1.43 archive, then applies the separate modal-window upgrade. `scripts/photon-0.1.42-patches.json` preserves the anchored delta from stock 0.1.42; `scripts/photon-modal-dialog-source.mjs` replaces its old full-editor dialog path. The script checks the target package version, unique anchors, JavaScript syntax, and staged archive contents. If an anchor changes in 0.1.43, it stops before installing and reports the affected file or hunk for a manual port. It never substitutes the full 0.1.42 archive for 0.1.43.

After installing 0.1.43 and fully closing Photon Studio, run from this repository in PowerShell:

```powershell
node scripts/migrate-photon-asar.mjs --target "$env:LOCALAPPDATA\Programs\Photon Studio\resources\app.asar" --expected-version 0.1.43 --install
```

The script stages and verifies `app.asar.photon-ai-staged-<timestamp>`, copies the current plugin data directory to a timestamped backup, moves the original 0.1.43 archive into that backup directory, and installs the patched archive. Omit `--install` to stop after staging and inspect the output; that staging run leaves its archive on disk. The script refuses installation while Photon Studio is running. Use `--data-dir` if Photon's plugin data is somewhere other than `%APPDATA%\Photon Studio\plugins\data`; use `--backup-dir` for a different backup location outside this repository. Plugin settings and credential files stay in their existing private data directory. Reopen Photon Studio and reload the development plugin folder after installation.

The 0.1.42 config patch was installed locally on 2026-10-06. Its prior archive is `resources/app.asar.before-config-2026-10-06`, and the plugin data backup is `%APPDATA%\Photon Studio\plugins\data.before-config-2026-10-06`. The separate-modal upgrade was installed later, with the prior archive at `resources/photon-ai-backups/2026-10-06-modal-window/app.asar`. The first live check found that the docked controls disappeared while the live view was in the modal. The follow-up dock-preview patch was installed on 2026-10-07; its prior archive is `resources/photon-ai-backups/2026-10-07-panel-preview/app.asar`. The installed controller passed syntax and marker checks. After reloading the development folder, Library opened outside the panel and its controls remained visible in the dock. A follow-up check confirmed the panel was usable after closing Library and the controls remained visible with Templates open. The installed bundle matched the rebuilt plugin and the registry reported no issues. The 0.1.43 migration still needs qualification against that release.
