# UI

Aperture's core UI uses an owned Shadow host, lazy settings markup/styles and the existing renderers and registries. Document-side add-on mounts and dialogs receive scoped ownership styles.

- [Settings and UI authoring](../guides/settings-ui.md).
- [Tabs and custom components](../settings-tabs/README.md).
- [Shared core settings](../core-settings/README.md).
- [Theme tokens](../theme/README.md).
- [Layer configuration](../ui-layers/README.md).

The shared shell belongs to core. Project sections come from metadata and custom panels from owned mount/cleanup hooks.
