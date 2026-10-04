# Configuration and storage

Project `settings.js` declares schemaVersion, project fields/defaults, migrations and effects. The shared schema engine, state manager, settings service, adapter and bootstrap retain ownership of validation, recovery and writes. See [settings/UI](../guides/settings-ui.md) for examples.

## Identity and schema

Keys use `aperture:<project-id>:<storage-namespace>:`. Keep those stable to retain data; display name/theme changes do not change storage. Changing identity selects another dataset and leaves the previous one intact.

New projects start at persisted schema 1. Migration registration begins empty; no historical product data is imported automatically. Future schema changes require explicit bounded steps and regression coverage. Project migration steps run during persisted configuration bootstrap. Older exported settings currently use transfer-format normalization rather than the project migration chain; renamed fields in old exports need additional transfer integration. Core adds reserved globalSettings and addons descriptors; projects declare only project-owned roots.

## Safe writes and recovery

Commit changes through `updateConfig(draft => { ... })` from the settings service. Check the structured committed result before reporting success. Validation, serialized revisions, readback, readiness and the sole write gate govern every commit. Metadata effects apply after a successful commit. Never write raw canonical storage from a feature/control.

Bootstrap probes read/write/readback/delete behavior. Reads can succeed while writes are unavailable. Degraded-readonly state disables persisted controls; unsettled, upgrade-required or failed readiness cannot authorize writes. Recovery retains the valid canonical/backup boundary and reports bounded issues rather than claiming a failed write succeeded.

| Storage surface | Owner |
| --- | --- |
| config and last-known-good backup | Settings service, strict commits and tolerant load recovery |
| recovery/migration markers and initialization/migration locks | Settings service, owned bounded leases |
| storage probe key | Adapter, owned probe cleanup |
| active-panel and pinned-add-on preferences | UI preference owner and readiness gate |
| regenerable catalogs/cache | Service cache owners, separate from user config |

## Import/export

Core supplies the transfer dialog. The transfer service validates project identity, format/schema and exportable field metadata before committing through the same gate. Preview does not mutate config. Browser file selection and dialogs remain in the core UI owners. See [transfer reference](../services/config-transfer.md).
