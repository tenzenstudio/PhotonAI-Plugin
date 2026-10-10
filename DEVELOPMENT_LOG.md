# DEVELOPMENT_LOG.md

## Unreleased

### Photon Studio 0.1.47 activation (2026-10-10)

Stock Photon Studio 0.1.47 rejects `sdk.config.get`, so the plugin never
finished activation and the AI panel stayed empty. The plugin now treats a
missing `config.get`/`config.set` as "use `settings.json`", a missing
`ui.customDialog` as an in-panel Library overlay, and a missing
`credentials.store` as a session that lasts only for this run. Device
sign-in, remembered OAuth, separate Library files, and the editor-wide
Library window still need Photon host work; see
`docs/photon-host-changes.md`.

### Shorter Edit action hints (2026-10-07)

Change and Replace now use concise labels that fit within the length of Add.
The prompt label and segmented control hover hint still share the same text.
This is plugin UI only and needs no ASAR patch.

### Edit prompt label follows the selected action (2026-10-07)

The prompt label in Edit now displays the selected Add, Change, or Replace
hint. The segmented control tooltip and prompt label share one source string,
so switching actions updates the visible instruction without changing the
prompt text or the provider request. This is a plugin UI change and needs no
ASAR patch.

### Card details header (2026-10-07)

The Saved and History card disclosure is now labeled Details. Its header
stays right aligned beside the edit action when expanded, so the same header
closes it without moving to another line. This is plugin UI only and needs
no ASAR patch.

### Collection transfer and card metadata layout (2026-10-07)

Saved, History, and Templates now have Export and Import in a footer beneath
the scrollable card area. All exports the active tab; a selected folder
exports only that folder. JSON carries each card's folder name, stacks,
order, prompt context, and image references. Import uses the matching tab,
recreates missing folders, assigns new card and image keys, and checks the
destination's storage budget before saving. Reimporting adds another copy;
the fixed Edit Prompts instructions update in place. A text filter does not
change export scope. The edit action and Request details now share a line on
Saved and History cards. The fixed Edit Prompts folder appears only in
Templates, where its three Edit instructions can be changed. This uses the
existing Photon file picker and
private config bridge, so no new ASAR patch is needed. Live cross-install
transfer has not yet been checked.

### Edit action hover hints (2026-10-07)

Add, Change, and Replace in the Edit segmented control now show short hover
hints describing what each action changes in the selection. The same text is
available to assistive technology. This is a plugin UI change and needs no
ASAR patch.

### Provider-aware Edit preservation (2026-10-07)

The Add, Change, and Replace defaults now describe the source image as the
starting composition, specify the one requested change, and limit extra
references to that change. A saved instruction is upgraded only if it still
matches the previous shipped default; user-edited instructions remain intact.
OpenAI sends a same-size source and transparent-alpha mask to the native edit
endpoint. GPT Image 1 and 1.5 also request high input fidelity; GPT Image 2
and 2.5 omit that unsupported option. Sunburst is first in the Edit model
list and is labeled Precise; Flare is labeled Fast.

Codex and Grok/X API continue to use the source plus a white-area selection
guide because their current routes do not expose a native mask. The shared
prompt guidance now names the image roles. Grok checks its five-image limit
before submission and lets Auto aspect ratio follow the first source image.
The preview now states whether the provider received a mask or a guide, and
reminds the user that Apply limits changes to the selection. The installed
Photon 0.1.42 encoder was inspected: its alpha mode maps selected coverage
to transparency, and the source and masks use the same resize path. No new
ASAR patch is needed. Live provider results and pixel-preservation behavior
remain unverified.

### Saved prompt context (2026-10-07)

Saving a prompt to Library now captures the same context as a new History
entry: active template text and filled or checked controls, Edit action and
instruction, provider/model and output choices, and both template and manual
image references. The saved card shows template and reference metadata; Use
restores the captured state even if the original template changes. Editing
the card changes its prompt text while retaining that state. Older Library
prompts remain text-only.

Both Library prompts and History share deduplicated image data in
`config-references.json`. Reference cleanup now retains images while either
tab uses them; the storage budget still prunes only old History entries.
The existing local config bridge covers this behavior, so no additional ASAR
patch is needed. Live Photon replay remains to be checked after reloading the
development folder.

### Structured prompt History (2026-10-07)

New History entries store the visible prompt separately from template and
edit instructions. Each entry snapshots its mode, Add/Change/Replace action
and instruction, provider/model, output choices, template text and field
values, transparency setting, and both template and manually attached image
references. The card shows operation and reference metadata; Use restores the
snapshot so later template edits do not change that History entry. Remove
requests also appear in History. Older flattened entries remain readable and
cannot recover metadata that was never stored.

Reference image snapshots live in the plugin's private
`config-references.json`, with identical image data shared across entries.
The storage budget prunes oldest History entries and unused images together.
The existing local host config patch already allows the `references` ID, so
no new ASAR patch is required. Focused History snapshot tests and the
TypeScript typecheck passed; live Photon replay remains to be checked after
reloading the development folder.

### Result actions (2026-10-07)

The generated result preview now places Apply, Discard, and Save as PNG in one
row directly below the image. The Apply explanation follows the row. This is a
plugin panel layout change and needs no additional ASAR patch.

### Edit actions and selection help (2026-10-07)

The visible Fill tab is now Edit. Its Add, Change, and Replace segmented
choices prepend separate preservation instructions to the user's prompt before
an edit request. The instructions live as editable cards in the fixed
**Edit Prompts** folder in Templates. Their source defaults ship in
`config/edit-prompts.json`, separate from the thirty general starter templates;
edits persist in the plugin's private Library config. The fixed folder and
three mode cards retain stable identities and cannot be deleted or moved.

The prompt-based mask explanation no longer takes a full line on Remove and
Edit. When a selection is active with a prompt-based edit model, a `?` beside
the selection guidance shows the same explanation on hover, focus, or click.
The internal `fill` mode ID stays in place for Photon command and provider
compatibility. This change needs no new ASAR patch beyond the separate modal
and plugin config host capabilities already documented.

TypeScript typecheck and build passed. No automated tests or live Photon
interaction were run for this change.

### Template conversion row labels (2026-10-07)

The template editor now shows `[model] · Convert to: JSON Text` at the right
of the Transparent image row. The two buttons keep their existing conversion
behavior and availability rules. This is a plugin UI change; no ASAR patch is
needed.

### Separate Library and Templates modal (2026-10-06)

The previous `ui.customDialog` host patch promoted the entire custom panel
view over the editor. Library and Templates therefore appeared inside a
full-screen panel background. The replacement controller patch creates a
separate modal Electron window, temporarily reparents the same plugin view,
and restores its dock bounds when closed. The plugin hides its panel content,
renders the collection before asking the host to show the window, and clears
the modal state if the window closes through the operating system. The nested
edit dialogs stay inside that window. `scripts/photon-modal-dialog-source.mjs`
contains the exact additional ASAR edits; the 0.1.43 migration applies them
after the earlier reviewed patch set. The patched 0.1.42 archive was staged,
its controller syntax checked, and installed after Photon Studio fully closed.
The previous archive is preserved at
`resources/photon-ai-backups/2026-10-06-modal-window/app.asar`. The installed
controller was checked for the new modal path. Live window behavior remains to
be qualified after restarting Photon and reloading the development folder.

The first live check confirmed Library and Templates open outside the panel,
but the docked panel controls disappeared while its view was moved. The host
patch now captures the panel before the move and keeps that image in a
temporary dock view. The original panel view still supplies the interactive
modal and returns to the dock on close. This follow-up archive was installed
after Photon Studio fully closed, with the prior archive backed up at
`resources/photon-ai-backups/2026-10-07-panel-preview/app.asar`. The installed
controller passed syntax and marker checks. The dock preview was checked in
Photon Studio after reloading the development folder. Library
opened as a separate modal and the AI panel controls remained visible in the
dock. The installed `plugin.js` hash matched `dist/plugin/plugin.js`; the
plugin registry showed zero issues and diagnostics. The same host path serves
Templates. A follow-up check confirmed the panel controls were usable after
closing Library and remained visible when Templates opened.

### Visual template fields (2026-10-06)

Template cards and the template editor now display valid `{{...}}` controls as
inline pills with a type icon and field name. The editor still saves the same
syntax for compatibility. A click selects a pill for copy, cut, deletion, or
dragging to another position; double-click or Enter opens a third-level field
dialog. All seven toolbar field forms use that dialog, including text and both
checkbox forms. Pasted valid field syntax becomes a pill. This is plugin-side
UI work and requires no additional `app.asar` patch.

### Codex template conversion controls (2026-10-06)

Renamed the editor action to **To text** and placed the selected model and
both conversion actions at the right of the Transparent image row. The
previous actions were disabled for the configured Codex `gpt-6-luna` model
because the conversion adapter omitted Codex. Text-capable Codex models now
use the signed-in account's selected model through the Codex Responses route.
The plugin reads its response stream through the existing SDK byte response,
checks for completion, and keeps the converted text unsaved until Save.
Known image-only models remain unavailable for text conversion. No new
`app.asar` patch is needed; this route has not been qualified by a live
conversion request in Photon Studio.

### Template text conversion (2026-10-06)

The template editor now offers **To JSON** and **To text** actions. They
send the current instructions to the selected, configured model and replace
the editor text only after a valid response. The user reviews the result and
presses Save separately. JSON output must be an object, and conversion rejects
a result that drops or changes a `{{...}}` field. Editing during a request
also prevents the late response from overwriting the newer text. Attached
references, name, and transparent-image setting are unaffected.

The selected model must return text. Codex, Gemini image models, compatible
custom models, and OpenAI text-capable models use existing credentials; known
image-only models have disabled conversion actions. No fallback model is
selected silently. Provider responses have not been qualified with a live
account. The feature uses existing network and job SDK capabilities and
needs no additional Photon `app.asar` patch.

### Multi-select dropdowns and field option editor (2026-10-06)

Added `{{Name|multiselect:separator=...|...}}` for a compact dropdown that
accepts several choices. The separator is stored in the tag and joins selected
prompt snippets in option order; existing visible `multi` checkboxes retain
their comma-space join. Dropdown, radio, checkbox-group, and multi-select
buttons in the template editor now open a small third-layer dialog to edit
field names and option labels/text, add or remove options, and reorder them
with a drag handle or keyboard. The dialog preserves unsaved template edits.
This is plugin-side only and needs no additional Photon `app.asar` patch.

### Photon Studio 0.1.43 migration path (2026-10-06)

Added `scripts/migrate-photon-asar.mjs` and the anchored 0.1.42 patch manifest.
After Photon Studio is updated to 0.1.43, the script can locate its hashed
panel assets, carry forward the controller, sign-in, full-window dialog, and
per-plugin config edits, stage and verify the new archive, back up plugin data,
and install it while Photon is closed. Changed patch anchors stop the migration
with a file and hunk number for manual porting. No 0.1.43 archive is installed
yet, so compatibility with that release remains unverified.

The 0.1.42 archive with `sdk.config.get/set` was installed while Photon Studio
was closed. The prior archive is `resources/app.asar.before-config-2026-10-06`;
the private plugin data backup is
`%APPDATA%/Photon Studio/plugins/data.before-config-2026-10-06`. The editable
Library migration will run when the new plugin build first loads.

The PR and host note now ask the Photon team explicitly to add named,
plugin-private configuration files as a supported host and SDK feature.
The local archive patch is only a development bridge for that request.

### Reference thumbnail close alignment (2026-10-06)

The remove-reference control on main-panel and template-card thumbnails now
draws its cross with two centered CSS strokes. Its accessible name stays on
the button. The change uses the Photon text token and no new host patch.

### Separate plugin configuration files (2026-10-06)

The thirty shipped template definitions now live in
`config/premade-templates.json` and ship as a separate package file. The
plugin reads and writes editable Library state through `sdk.config.get/set`
in a plugin-owned `config-library.json`; main `settings.json` keeps provider
preferences and model cache only. On first load, the plugin copies an older
Library out of settings, writes the new config file, and then clears the old
settings field. Existing template edits, deletions, folders, references,
history, and order are preserved. A host controller patch is required for
this new capability; see `docs/photon-host-changes.md`.

### Prompt-save error color (2026-10-06)

The empty-prompt save message now uses Photon's normal text color while its
left marker stays red. This follows the active skin and needs no Photon
`app.asar` patch.

### Main panel reference picker fix (2026-10-06)

The add-reference square opened a file picker but ignored the selected file.
Its change handler checked the empty value of a Boolean data attribute, so
it returned before resizing or attaching the image. The handler now checks
for the attribute's presence. This is plugin-side only and needs no Photon
`app.asar` patch.

### Editor toolbar and folder icon polish (2026-10-06)

The template editor presents Markdown actions and field insertion as two
matching, single-line toolbars. Narrow dialogs scroll each toolbar
horizontally instead of wrapping buttons into extra rows. Markdown image
insertion was removed because images are attached as references. The inline
code action now reads Code. Folder rename uses the same bundled pen SVG as
card editing, sized and centered beside the folder trash SVG. These are
plugin UI changes and require no new Photon `app.asar` patch.

### Thirty premade templates (2026-10-06)

The Template library now includes 30 starters. Version 3 seeds twenty new
cards for print and editorial artwork, digital marketing, commercial
imagery, brand assets, and image edits. Existing edits, deletions, folders,
references, and order are preserved; new cards append after the current
order. `docs/premade-templates.md` records the full set, intended mode,
controls, and Adobe research basis. The change is plugin-side and needs no
additional Photon `app.asar` patch.

### Live Library and Templates search (2026-10-06)

Both collection content toolbars now have a search field. Typing filters
cards immediately by template name, prompt or template text, and the date
shown on prompt cards. A stack remains in the results when any version
matches; search opens that stack so the match is visible. Search only filters
the current view and does not change saved cards or their order. Escape in a
nonempty search field clears it. The centered field has a bottom hairline,
dim Filter Prompts or Filter Templates placeholder, and initial focus when
its dialog opens. This is a plugin UI change with no new Photon `app.asar`
patch.

### Independent card columns (2026-10-06)

Library and Templates cards now flow into vertical columns. Each card and
expanded stack keeps its own height, so a tall item no longer leaves a blank
space under shorter items beside it. Stacks stay together within a column;
the separate-from-stack drop area spans the content width. This uses the
plugin stylesheet and needs no Photon `app.asar` patch.

### Shared trash icon (2026-10-06)

Folder deletion and the remove-applied-template control now use the same
bundled trash SVG as Library and Templates cards. The folder still requires
two clicks within two seconds to delete. This is plugin-side only; it adds no
Photon `app.asar` patch.

### Full-size prompt and template editor (2026-10-06)

Editing a Library, History, or Templates card now opens a second modal layer
above the collection dialog. The editor has a large textarea and Markdown
toolbar for headings, emphasis, quotes, lists, links, tables, code,
and rules.
Template editing adds insertion buttons for all six field examples. New
Template opens the editor directly; Cancel does not create an empty card.
The Transparent image help glyph opens a short capability note. OpenAI and
Codex send a transparent PNG request; Grok adds a prompt instruction, since
xAI does not document a transparent-background request parameter. The Grok
result may be opaque. Other providers and Fill mode remain blocked for this
template option. The editor is nested inside the existing promoted plugin
view and needs no additional Photon `app.asar` patch.

### Double-brace template fields (2026-10-06)

Template controls now use `{{...}}`; ordinary single braces stay in the
provider prompt, including JSON objects. Saved single-brace template fields
are converted once on load. The premade cards and Template Fields guide show
the new form. Tag parsing supports escaped pipes, arrows, braces, and
backslashes in option text. A literal `{{` can be written as `\{{`.
Unfinished or invalid tags remain plain text. No Photon host patch is needed.

### Template authoring help (2026-10-06)

The Templates content toolbar now places Template Fields to the right of New
Template. Its info glyph toggles a concise guide to free-text, dropdown,
radio, multi-checkbox, and two-state checkbox tags. Valid tags in saved
template cards use the Photon accent token; regular template text keeps the
skin's normal text color. Toggling the guide leaves unsaved card edits in
place. Escape closes the guide before it closes the dialog. The guide takes
its natural height, without an inner scrollbar. This is a plugin UI change
and requires no additional Photon `app.asar` patch.

### Template field taxonomy (2026-10-06)

Typed template tags now support dropdowns, visible single-choice radio
groups, multiple-choice checkbox groups, and single checkboxes with an
optional alternate unchecked snippet. Short option labels can map to longer
prompt text. Existing free-text and colon-separated dropdown tags continue
to work. Unselected multi-choice fields and checkboxes with no unchecked
snippet insert no text. Ten premade templates use the controls where they
fit the design task. The version 2 seed updates untouched starter text but
keeps edited and deleted cards, references, folders, and order. The template
syntax is documented in `docs/library-and-templates.md`. No new `app.asar`
patch is required; controls are rendered by the plugin's custom panel.

### Card action icons (2026-10-06)

Library, History, and Templates cards now use the pen, trash, and magic wand
SVGs from `svg/` for Edit, Delete, and Use. The edit control still changes to
a checkmark when saving. SVG markup is bundled into the panel script, so the
installed plugin needs no separate icon files or new Photon host patch. CSS
uses `currentColor` and existing Photon skin tokens, including the red
two-click delete state. Font Awesome attribution ships in
`THIRD_PARTY_NOTICES.txt` with the plugin package.
The Use icon shares the same muted grey and hover color as Edit and Delete.

### Library interaction follow-up (2026-10-06)

The empty Save prompt message now appears immediately below the prompt box
and clears when the prompt changes. Signed-in Codex and Grok quota text sits
at the right of the Model label when there is no error, saving one panel row.
Template cards now place ＋ Reference and icon-sized image thumbnails at the
lower left, opposite the action glyphs. Hovering a thumbnail reveals a larger
preview.

Prompt, history, and template cards can be dragged to reorder, grouped by
dropping onto a stack, separated with the drop area shown during a stacked
drag, and reordered inside an expanded stack. Explicit stack choices persist
in library settings alongside the existing fuzzy grouping for untouched
cards. No Photon host archive change is needed for these interactions; the
existing `sdk.ui.customDialog` patch remains required.

### Library and Templates

Library and Template card actions now use a font trash glyph for Delete and
a font sparkles glyph for Use. Edit keeps its existing pencil glyph. The
prompt-save bookmark and applied-template trash also use font glyphs. The
monochrome characters use Windows Segoe UI Symbol and inherit Photon's skin
text colors. The installed Photon archive has no bundled icon font; its
existing Inter font does not contain these symbols.

Card and folder deletion now use the trash glyph itself for confirmation:
the first click arms it with Photon's danger color for two seconds, and a
second click on that same glyph deletes the item. Clicking elsewhere,
pressing Escape, starting a drag, or the timeout disarms it. This removes
the delete-confirmation buttons above the collection content.
TypeScript typecheck and package build passed. Photon Studio reloaded the
development folder at 20:42 local time; installed JavaScript and CSS hashes
match `dist/plugin`, with zero registry issues and diagnostics. The timing
and red state still need a direct visual check inside the editor.

AI Studio now builds as a custom Photon panel. Library and Templates buttons sit beneath the visible prompt on one row. Their editor-wide modal uses a classic two-column layout: folder sidebar on the left, cards on the right. The dialog has a compact title bar without a subtitle or decorative header. Cards support editing, deletion, drag ordering, and stacks of similar text. History records submitted prompts, including expanded template context. Templates supply hidden context alongside the visible prompt; `{name}` and `{name:one|two|three}` produce controls beneath it. Attached and manual image references appear as cropped square thumbnails and are sent to supported image adapters.

The dialog now asks the host for `sdk.ui.customDialog`, which promotes the plugin view above the full editor. The patched 0.1.42 archive is installed as `resources/app.asar`; the previous archive is preserved as `resources/app.asar.before-modal`. The source patch is in `scripts/patch-photon-host.mjs`, with the required behavior in `docs/photon-host-changes.md`. Unbounded binary storage still needs a separate Photon host/SDK change. Current reference images are resized and stored under a 650 KB budget inside Photon's 1 MB settings limit; oldest history is pruned as settings approach 940 KB. Reference request shapes for Codex and Grok still need live account qualification.

Verification on 2026-10-05: TypeScript typecheck, build, packaging, and documentation checks passed after the editor-wide modal change. Earlier, 85 tests passed. Photon Studio reloaded the development folder and its registry records the custom panel entrypoint. The patched archive passed a JavaScript syntax check and Photon Studio restarted with it at 19:48 local time. Prior registry diagnostics recorded `Unsupported Photon SDK capability: ui.customDialog` before restart; no dialog interaction has been observed after restart. The full-window appearance is pending a Photon Studio visual check. The earlier browser preview was not a Photon Studio screenshot and is not evidence of in-editor appearance.

The installed `app.asar` contains `credentials.read` and `credentials.store`; `app.asar.bak` does not. The current registry has no `credentials.read` diagnostic after the development folder reload. An editor session using the old archive still needs a full restart to pick up host changes.

The prompt field now has a borderless save icon in its upper right corner.
It saves the visible prompt directly to Library's All prompts folder.
The Library dialog no longer has a Save current prompt button.
The All prompts sidebar row no longer stretches to fill the sidebar height;
folder rows retain their normal line height.
TypeScript typecheck and package build passed after these adjustments.
Photon Studio loaded this build from the development folder.

After that reload, Photon reported `prompt() is not supported` when folder
controls were used. Folder creation and rename now use inline sidebar inputs;
folder and card deletion use confirmation controls in the collection dialog.
Reference errors also render inside the plugin instead of calling browser
alerts. The applied template's Remove action is now a right-aligned trash
glyph in its card header. TypeScript typecheck and package build passed for
this follow-up. Photon Studio reloaded the replacement at 19:59 local time;
the installed bundle contains the save icon, inline folder controls, template
trash glyph, and `sdk.ui.customDialog` request. Registry diagnostics were
empty after that reload. A visual check in Photon Studio remains separate;
no browser preview is presented as an editor screenshot.

### Photon skin colors

The active custom panel now receives Photon's theme payload and applies its
`--ph-*` CSS tokens at startup and whenever the editor changes skin. All
hard-coded interface colors and local color aliases were removed from
`src/panel.css`; the same rules now follow dark, soft dark, soft light, and
light. The previous visual attempt is preserved exactly in
`docs/panel-style-draft.css`, with its four-skin adaptation documented in
`docs/panel-style-draft.md` for later use.

Verification on 2026-10-05: typecheck, package build, documentation checks,
and diff whitespace check passed. The active stylesheet has no hex/RGB
colors or local color aliases; every used `--ph-*` token is present in the
custom-panel theme payload of the installed Photon host. Photon reloaded the
development folder at 20:11 local time. Its installed bundle contains theme
request and change handling, the installed CSS has no fixed colors, and the
plugin registry reports no diagnostics. Visual appearance in all four skins
has not yet been inspected in Photon Studio.

Photon's 0.1.42 skin CSS gives `light` and `softLight` the same `--ph-accent`,
so Generate Image and Apply retained the same filled color across those
skins. Primary actions now use `--ph-black-7` for the surface, `--ph-text`
for the label, and `--ph-stroke-strong` for the border. Those surfaces differ
in all four skins. The earlier blue fill remains only in the archived
stylesheet.
Typecheck, package build, and documentation checks passed for this fix.
Photon reloaded the development folder at 20:16 local time; the installed
stylesheet contains the skin-specific primary action rules and the plugin
registry reports no diagnostics. Appearance still needs a direct visual
check in the editor.

Keep provider keys and device sessions in Photon's credential vault. Do not place them in library or template records.

### Premade Template library cards (2026-10-05)

Added ten editable templates for transparent cutouts, studio product imagery,
lifestyle product scenes, background replacement, scene objects, portrait
refinement, poster art, social campaigns, website heroes, and seamless surface
patterns. Each card demonstrates named free-text fields and dropdowns. The
research basis, template list, and the absence of a measured usage ranking are
documented in `docs/premade-templates.md`.

The library now stores a template seed version. It installs missing premade
cards once for existing or new libraries, then respects edits and deletion.
Transparent PNG is a template-level option. On OpenAI GPT Image Generate
requests, the adapter sends `background=transparent` and `output_format=png`;
other provider/mode combinations stop before a request. This change requires
no additional Photon `app.asar` patch beyond the custom-dialog capability
already documented for the Template library.

TypeScript typecheck and package build passed. Photon Studio reloaded the
final development folder at 20:28 local time; its installed `plugin.js`
matches `dist/plugin/plugin.js`, and the registry shows zero issues and zero
diagnostics. A live alpha output from an OpenAI account and the appearance of
all ten cards inside Photon Studio are not yet verified visually.

### Provider output options

Output size and Quality fill from each provider's published options when the user signs in, and again when a signed-in provider loads or is selected again.

| Provider | Output size | Quality |
| --- | --- | --- |
| OpenAI and Codex GPT Image 2.5 | Auto, plus the published sizes through 3840×2160 | Auto, Low, Medium, High, Extra high, Max |
| GPT Image 2 | Same sizes | Auto, Low, Medium, High |
| GPT Image 1 and ChatGPT Image | 1024×1024, 1536×1024, 1024×1536 | Auto, Low, Medium, High |
| Codex chat models that only accept images | Menu hidden | Menu hidden |
| Gemini 3.1 Flash Image | Aspect ratios, including 1:4, 4:1, 1:8, and 8:1 | 1K, 2K, 4K, 512 |
| Gemini 3 Pro Image | Standard aspect ratios | 1K, 2K, 4K |
| Gemini 3.1 Flash Lite Image | Standard aspect ratios | 1K |
| Gemini 2.5 Flash Image | Its fixed pixel sizes | Menu hidden |
| Grok Imagine 2.0 and X API | Aspect ratios, including 21:9 and 5:2 | Auto, Low, Medium, also at 1.5K and 2K |
| Grok Imagine | Aspect ratios except 21:9 and 5:2 | 1K, 2K |
| Ideogram 4.5 | Auto and the published 1K and 2K presets | High, Medium, Low, Very low |
| Black Forest Labs FLUX.2 | Width and height presets up to 2048×2048 | Menu hidden |
| fal FLUX Dev | The six official size presets | Menu hidden |
| Replicate FLUX Dev | 1:1, 16:9, 21:9, 3:2, 2:3, 4:5, 5:4, 3:4, 4:3, 9:16, 9:21 | Menu hidden |
| Together FLUX.2 | 1024×1024, 1344×768, 768×1344 | Menu hidden |
| Midjourney | 1024×1024, 1536×1024, 1024×1536 | Menu hidden |
| Custom | The sizes and qualities you type | The sizes and qualities you type |

Very low on Ideogram is sent only for an edit. Midjourney still does not call an image API. Host changes required before these flows run on stock Photon are in [Photon host changes](https://github.com/apoapostolov/PhotonAI-Plugin/blob/development/docs/photon-host-changes.md).
