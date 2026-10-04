# Theme tokens and scoped UI

Aperture themes the shared Shadow UI and owned add-on roots. Projects select theme tokens and optional UI metadata; core supplies the dock, settings shell, dialogs, renderers and registries.

## Authoring a theme

Set `config.json`'s `theme` to `default` or `light`, or create another `themes/<name>/index.css`. `themes/default/index.css` is always required and validated, even with a custom selection. A missing, invalid, outside-directory or symlink-escaping selection fails before output publication. Ordinary smoke commands do not bump versions or update tracked distributions.

A version-one theme starts with `/* aperture-theme:1 */` and contains one `:root` block of all 33 `--aperture-*` declarations. This is an authoring container: runtime delivery replaces its selector with the project's owned-root selector. Unknown, missing or duplicate tokens, additional selectors, network URLs, arbitrary CSS, channels above 255 and files above 16 KiB are rejected. Colors accept six-digit hex or bounded `rgba(...)`; shadow accepts `0 Npx Npx rgba(...)`. Four optional dock tokens (`dock-accent`, `dock-accent-hover`, `dock-accent-active`, `dock-border`) separate launcher colors from settings controls. When omitted, they inherit the corresponding accent states and control border; existing custom themes remain valid. The default dock retains the bright red and inset border. Two optional add-on colors (`addon-running`, `addon-pinned`) distinguish active and pinned badges; they fall back to success and accent for existing custom themes. Status badge backgrounds and borders use translucent mixes of their semantic colors. Add-on descriptions retain the bordered note layout, and settings panels use a translucent card surface. Definitions are canonicalized in stable token order. No network fetch or user-facing picker is supplied. Runtime switching is deferred.

| Tokens | Meaning |
| --- | --- |
| accent, accent-hover, accent-active, focus, on-accent | Action states, keyboard focus and action text |
| text-primary, text, text-secondary, text-muted | Text hierarchy |
| modal, sidebar, card, control, raised, row | Surface hierarchy |
| border-strong, border-control, border-subtle, divider | Edges and boundaries |
| backdrop, shadow | Overlay and elevation |
| scrollbar-track, scrollbar-thumb, chip | Scrolling and neutral chips |
| success, warning, error, disabled | Semantic foregrounds |
| success-surface, warning-surface, error-surface | Toast/status surfaces with on-accent text |
| accent-subtle, accent-border | Soft accent surfaces and boundaries |

Every theme supplies every required token; custom selections do not silently merge default values. Component CSS also keeps its literal fallback for standalone CSS consumers. These literals are fallbacks, not a second bundled theme. Shared structural classes use `aperture-page-dock-*` and `aperture-addon-*`; per-project host IDs derive from project identity and storage namespace. Framework theme variables use `--aperture-*`.

## Scope and ownership

One registry-owned document sheet supplies values only to `[data-aperture-ui-owner="<project-id>:<storage-namespace>"]`. The Shadow host, page add-on hosts, mounts, dock groups, dialog overlays and fallback toast container are explicitly owned. Variables inherit across the Shadow boundary. Website `html`, `body` and other elements receive no theme definitions or layout rules. The fallback toast layout is extracted from the startup stylesheet and prefixed to its owned container.

Structural startup and modal CSS remain in their files. A small accessibility stylesheet joins the startup registry entry, preserving lazy modal acquisition and style element/refcount behavior. Focus-visible, reduced motion and neutral chip styling are scoped inside the owned Shadow UI. The launcher retains its 250 ms slide; the browser's reduced-motion preference disables transitions. Browser coverage checks intermediate slide positions with normal motion and immediate changes with reduced motion. resource/listener/style registries own host removal, subscriptions, resize listeners, dock timers, toast frames/timers and dialog cancellation.

The add-on UI host retains its registries, sanitization, ownership checks, pending mounts, dialog sizes, focus handling and cleanup APIs. Sanitized styles are delivered to the document and, when available, the Shadow style registry. Styles registered before a dock exists are attached when it mounts. Updating or unregistering a style updates/removes both deliveries. Generic selectors include both project owner and add-on owner. Root-concatenated sibling selectors are omitted so a rule cannot escape an add-on root into its sibling.

An override declared on your add-on panel has precedence over inherited theme values; children inherit it. Give the panel the `my-panel` class for this example. Use the sanitized registration API:

```css
.my-panel { --aperture-accent: #663399; }
.my-control { background: var(--aperture-accent); color: var(--aperture-on-accent); }
```

The existing example stylesheet consumes these values and includes an opt-in `example-accent-override` class on `.aperture-example-panel`. Other add-ons and core values stay unchanged. A standalone add-on has no automatic core inheritance: its authored CSS fallbacks apply unless it supplies its own owned definitions. The standalone browser check tests CSS fallback behavior, not a standalone add-on runtime or manager installation. See [add-on contracts](../addon-platform/README.md) for trust, bridge and catalog transport.

## Project UI layers

Set `zIndex` in the project `build.ui` module to clear site overlays while preserving dock/settings/dialog/toast ordering. See [layer configuration](../ui-layers/README.md) for bounds, offsets and stacking-context limits. Layer values are separate from the color theme contract.

## Project settings input

`build.ui` optionally points to a pure project module. `projects/example/ui.js` contributes declared settings through the `contributeToSection` API and toggle/number metadata. [Tab metadata](../settings-tabs/README.md) declares project sidebar tabs, section containers and optional owned components. General and Add-ons remain permanent; legacy `sections` contributions render under General. Referenced configuration paths must exist in the shared schema. Optional `hooks` provide product-specific initialization, add-on rendering and tag actions; `numberPolicy` supplies any special number coercion; Core `globalSettings.configVisibility` owns dock visibility; projects no longer supply that preference. The four [core settings controls](../core-settings/README.md) are always contributed by the shared UI. Project defaults provide settings through injected inputs.

Keep the definition pure at module initialization; import live UI lazily from application hooks to avoid state initialization cycles. Writes still go through `updateConfig`; unavailable storage disables controls and shows the read-only notice. The framework does not add an alternate persistence or control system.

## Validation

Use `npm run test:theme` and `npm run test:theme:browser` for selected-theme bundles, palette contrasts and actual UI/owned mount behavior. Browser fixtures use a GM stand-in. Theme authors must verify their own pairings, translucent composites and host context.
