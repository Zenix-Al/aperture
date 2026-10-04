# Settings and UI

Project `settings.js` owns persisted schema/defaults, migrations and setting effects. Project `ui.js`, selected by `build.ui`, owns presentation metadata. Config path names must agree between schema, controls and features. See the complete setup in [Create a site project](create-project.md).

Core always supplies General and Add-ons tabs, Show configuration button, Import / export settings, Feature Health and Add-ons service settings. Projects add controls rather than recreating these shared services. Core reserves the `globalSettings` and `addons` schema roots.

Use `tabs` metadata for sidebar tabs and `sections` maps for renderer-owned controls. Containers are created from metadata; do not add project markup to the shared shell or rely on `global-settings-container` as an authoring hook. A feature may contribute metadata to a declared section through the existing registry.

For a rich custom tab, import a project component from `projects/<project>/ui/<name>.js`. Its `mount(context)` returns a cleanup function, synchronously or asynchronously. Context supplies `container`, `signal`, owned `listen` and `resources.register`. Components mount once per UI lifetime; modal close hides them and full teardown disposes them. See [tab metadata and component hooks](../settings-tabs/README.md).

Persist changes through the shared write gate:

```js
import { updateConfig } from "../../src/services/settingsService.js";
const result = await updateConfig(draft => { draft.helperEnabled = false; });
if (!result.committed) {
  // Report that the setting was not saved; do not bypass the storage gate.
}
```

Storage bootstrap, schema validation, recovery and serialized commits remain shared. New projects begin at schema 1 with no historical product import. A future schema change needs explicit bounded migrations and tests. Imported documents are schema-checked and bound to project identity.

Set `theme` in project JSON to `default`, `light` or another valid theme directory. Only that theme is bundled. See [theme tokens](../theme/README.md). Document mounts receive owned scoped styles; core settings use Shadow DOM.

Set `zIndex` in project UI metadata when the site places overlays above the framework. The default base is 10000; Reading Desk uses 100000. The framework derives floating/dock/settings/dialog/toast layers; [layer bounds and offsets](../ui-layers/README.md) explain the contract. Ancestor clipping/stacking contexts and browser top-layer UI require separate investigation.


The Add-ons service dialog includes a default-off Allow untrusted add-ons preference. Enabling requires confirmation and retains declared scope/capability and known-catalog identity checks. This preference is persisted locally and excluded from config transfer. Core UI typography is isolated from the host page; color accents come from the selected theme.
