# Photon AI Studio

A Photon Studio plugin for **BYOK image generation, AI object removal, and generative fill**.
Bring your own OpenAI, Gemini, Ideogram, Black Forest Labs, fal.ai, Replicate, Together AI, or X API key,
or sign in to Codex and Grok. Custom OpenAI-compatible services are supported too. Images go directly from your device to
that provider. Photon does not supply credits or proxy requests through a Tenzen account.

## Build and install

Requires Node.js 22 or later and a Photon build containing SDK v1.
The current plugin also needs Photon's host changes for device sign-in,
editor-wide dialogs, and separate per-plugin configuration files; see
[Photon host changes](docs/photon-host-changes.md). Stock 0.1.42 and 0.1.47
lack these capabilities. The panel still opens on 0.1.47 by falling back to
`settings.json` and an in-panel Library overlay. Per-plugin configuration
files are a proposed host and SDK feature expansion; the local archive patch
is a development bridge.

```sh
npm ci
npm run check
```

In Photon, choose **Plugins → Manage Plugins → Install package…** and select
`dist/photon-ai-studio-1.0.0.photon-plugin`. Enable it and open **AI Studio**.
For development, **Import folder…** → `dist/plugin`; after rebuilding, use
**Reload development folder** and reopen the panel.

Choose a provider and **Connect provider**. Photon opens its own password field; the plugin
receives a credential reference, never your saved key. Configure a separate key per provider.
Click Generate, Remove, or Edit explicitly to make a billable provider request.

- **Generate:** enter a prompt, preview the result, and Apply into a new RGB document.
  Enable “Insert into the current document” to place it into an existing RGB document instead.
- **Remove:** select unwanted content, invoke **AI Remove…** from the selection menu, and preview.
- **Edit:** make a selection, invoke **Generative Fill…**, choose Add, Change, or Replace, and describe the edit.
- **Apply:** creates a named layer and one undo step. Selection edits have an editable mask.
  Source layers remain unchanged. If the source document changed, regenerate before applying.
- **Library:** save prompts, revisit every recent successful use in History, and expand stacks of similar revisions.
- **Templates:** apply reusable context with editable text fields, dropdowns, radio groups, checkboxes, multi-select dropdowns, and attached image references. The visible prompt remains separate from template context.

See [Library and Templates](docs/library-and-templates.md) for field syntax, folder and card controls, reference support, and storage limits.

## Plugin developer guide

Start with [the guide index](docs/README.md), [quickstart](docs/quickstart.md), and
[SDK API reference](docs/sdk-api.md). Runnable [examples](examples) demonstrate a command,
native panel, selection-aware filter, and provider adapter. `npm run examples` builds their
installable development folders; `npm run check` typechecks the examples alongside the plugin.

The SDK tarball is included in `vendor/`, so this repository builds without a Tenzen checkout.
Source is hosted at [tenzenstudio/PhotonAI-Plugin](https://github.com/tenzenstudio/PhotonAI-Plugin).

## Current boundaries

AI edits support RGB documents and regions up to 16 megapixels. Providers operate on an
8-bit sRGB reference; source document precision/profile remain intact. Results are converted
back to the destination RGB space and depth. Model-specific editing support differs; the
panel identifies prompt-based editing. Remote cancellation is best effort and cannot undo
provider billing. See [provider setup](docs/providers.md) and [verification](docs/verification.md).

## License

Licensed under the [MIT License](LICENSE). Copyright (c) 2026 Tenzen Studio.
