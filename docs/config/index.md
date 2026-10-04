# Configuration

- [Project build-time JSON](../build/project-config.md): identity, matches, build paths, routes and selected theme.
- [Settings authoring](../guides/settings-ui.md): persisted project schema, controls and effects.
- [Storage contracts](../storage/README.md): readiness, validation, recovery, migrations and safe writes.

Build config and persisted user settings are separate. Keep project IDs/storage namespaces stable, declare new persisted fields in the project schema, and commit through the existing write gate.

