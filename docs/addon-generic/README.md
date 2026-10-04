# Generic add-ons and configured updates

`addons/example-addon/src/main.js` is a site-neutral API playground. Registration, launcher label, dialog titles, heading and owned styles follow its manifest identity. The shared adaptor, bridge and lifecycle own queue cancellation, storage and UI actions. Structural classes use the Aperture prefix; mount and host IDs are project-scoped.

Reading Desk's bookmark is [project-owned source](../../projects/reading-desk/bookmark.js), selected by its manifest. It uses the shared adaptor and lifecycle. Manifest validation checks the selected source, output paths, matches and permissions before building.

## Catalog check endpoint

The selected project `config.json` may declare:

```json
{
  "addonUpdates": {
    "catalogURL": "https://updates.example.org/my-project/trusted-addon-catalog.meta.json"
  }
}
```

This is the metadata endpoint. The existing checker reads its identifier and hash-addressed catalog filename; catalog files are resolved in the same directory. URLs must be absolute HTTP(S), without credentials or fragments. Query parameters are preserved when the six-hour check token is added. The checker keeps caching, catalog validation, SHA-256 verification and explicit forced reload. Stored remote caches are bound to the configured endpoint so changing hosts cannot reuse the earlier endpoint's authority.

Omit `addonUpdates` or use `"addonUpdates": {}` to use the validated bundled project catalog without remote requests. The default example does this. Old `build.addons` policy URL fields cannot override the JSON endpoint; that input still supplies local catalog/security policy and extensions. No repository/CDN URL is supplied by the framework.

Each add-on's `updateURL` and `downloadURL` stay in the selected project's add-on manifest. They are userscript-manager update/install metadata, separate from the core catalog endpoint, and never inherit the core URLs. Hosting and browser/manager network permissions must support the selected endpoint; configuring a URL does not publish the catalog or grant new permissions. Remote hash validation is integrity checking, not a signature/trust-distribution service.

Use [Build and test](../guides/build-test.md) for add-on validation commands. Unit tests cover catalog configuration and namespace isolation; production-bundle browser tests cover registration, settings, scoped styles and cleanup.
