# Shared services

Services own cross-feature work beneath project features. The public-module inventory is maintained by `check:inventory`:

<!-- GENERATED:SERVICE-INVENTORY:START -->
- `addonsService.js` — `src/services/addonsService.js`
- `configChangeApplication.js` — `src/services/configChangeApplication.js`
- `configMigrationService.js` — `src/services/configMigrationService.js`
- `configTransfer/index.js` — `src/services/configTransfer/index.js`
- `notificationService.js` — `src/services/notificationService.js`
- `settingsService.js` — `src/services/settingsService.js`
- `storageAdapter.js` — `src/services/storageAdapter.js`
<!-- GENERATED:SERVICE-INVENTORY:END -->

`storageAdapter` provides storage I/O; `settingsService` owns validated commits/recovery and live configuration; `configChangeApplication` applies committed setting effects; `configTransfer` validates project-bound import/export documents. Storage bootstrap and readiness gate writes. `addonsService` owns the catalog, trust, bridge and lifecycle rather than delegating them to project features.

See [storage](../storage/README.md), [config transfer](config-transfer.md), [settings/UI](../guides/settings-ui.md) and [add-on authoring](../guides/addons.md).

