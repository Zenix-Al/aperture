# Changelog

## v1.1.0

### Added

- Optional add-on platform through top-level `"addons": false` in project configuration. Builds exclude add-on runtime modules, configuration schema, catalogs, settings UI and assets; omitted or `true` keeps the platform enabled.
- A core-only example at `projects/example/core-only.json`, with a separate storage namespace and output directory. Both readable and release smoke builds verify platform exclusion while preserving core infrastructure.
- Regression coverage for core-only settings, persistence, diagnostics, import/export, reload and teardown, plus build graph checks that reject direct add-on imports when the platform is excluded.

### Fixed

- Cross-tab settings writes now serialize fresh persisted read-modify-write operations under a namespaced Web Lock. Writes fail closed when secure-context or Web Locks requirements are unavailable.
- Storage recovery preserves recovered settings and backups when writeback fails, prevents false committed-state reports, and rolls back mixed configuration/cache writes safely.
- Add-on persistence merges state changes against fresh storage, retains installation sightings and pinned shortcuts during temporary runtime absence, and removes shortcuts only after explicit removal succeeds.
- Add-on CSS sanitization rejects selector escapes, leading sibling selectors and unsafe image-set content.
- IndexedDB transactions abort when write callbacks throw or reject; transaction completion and bulk request failures are handled consistently.
- Partial configuration imports apply to fresh locked settings. File size is checked before reading, dialog cancellation and focus are owned, and download URLs remain available long enough for browser consumption.
- Core settings synchronize the initial active panel independently of the add-on renderer. Theme fixtures and isolated UI layer tests cover both build modes.
- The test harness reports unsettled tests as failures instead of allowing an incomplete run to pass.

### Documentation and verification

- Updated project configuration, project authoring, runtime, storage, configuration transfer and add-on platform documentation for the new contracts.
- Refreshed accepted source, CSS and add-on audit measurements without changing numerical gate limits.
- Verified 287 unit tests, 17 browser tests and 15 static/smoke checks before the framework version update.

### Compatibility

- The framework version is `1.1.0`; Settings and Feature Health embed it on rebuild. Project and add-on userscript versions and storage schema versions remain independent.
- Cross-tab writes require a secure context (HTTPS or trusted localhost) and Web Locks support.
- Choose add-on inclusion before deployment. Switching an existing project to core-only changes its configuration schema; use an explicit project migration or a separate storage namespace.

## v1.0.0

- Initial release
