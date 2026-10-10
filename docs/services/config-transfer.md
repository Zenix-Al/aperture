# Configuration Transfer Service

`src/services/configTransfer/` owns configuration export and import documents. It is deliberately independent of the DOM and uses the shared schema, persistence, and config-change application boundaries.

## Export contract

`buildConfigExport()` constructs a document containing:

- `formatVersion` for the transfer-document format;
- `schemaVersion` for the configuration contract;
- `applicationVersion` when supplied by the userscript manager;
- `exportedAt`; and
- `settings`, whose keys are selected from schema metadata marked `exportable`.

Runtime-only state, add-on runtime state, and other non-exportable values are not included.

## Import contract

`previewConfigImport(input)` accepts a JSON string or parsed object. It validates the document shape, supported format/schema versions, exportable roots, and nested values through `CONFIG-01`. The one supported legacy transfer format is normalized on a clone; this is transfer-document compatibility, not persisted-storage migration. The result reports changed sections, changed paths, warnings, and reload metadata without storage, live-config, DOM, or effect changes.

`commitConfigImport(input)` previews first, then rebuilds the partial import against fresh configuration inside `settingsService.updateConfig()`'s write lock. Omitted and sensitive fields retain their current values. Persistence succeeds before the shared config-change application pipeline updates live state. The UI reloads after successful file import; failed or cancelled imports do not reload. The preview's `reloadRequired` metadata remains available to service callers.

Project-declared imported caches are persisted separately before the canonical envelope; a failed commit attempts to restore the previous cache and reports rollback failures.

`src/ui/configTransfer/` owns file selection, JSON text acquisition, downloads, dialog rendering, and toast/error presentation; it does not own transfer-format or persistence rules.

The picker handles explicit cancellation and an owned focus fallback. JSON files larger than 5 MB are rejected before reading, and reader errors produce a bounded message. Download URLs survive for ten seconds and are revoked during owner cleanup.
