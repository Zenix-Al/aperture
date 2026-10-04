# Aperture documentation

For a first project, follow these in order:

1. [Run Reading Desk](example/quickstart.md) to see core settings, routes and an add-on working together.
2. [Architecture](guides/architecture.md) to understand shared infrastructure and project inputs.
3. [Create a site project](guides/create-project.md) for a complete file-by-file setup.
4. [Build and test](guides/build-test.md) to generate scripts and validate them.

## Authoring guides

- [Features](guides/features.md): discovery, lifecycle and owned resources.
- [Settings and UI](guides/settings-ui.md): schema, persistence, tabs and custom panels.
- [Add-ons](guides/addons.md): source layout, manifest, capabilities, builds and updates.
- [Reading Desk troubleshooting](example/troubleshooting.md).

## API references

- [Project JSON configuration](build/project-config.md).
- [Core modules](core/index.md): factories, observer, queue, bridge and registries.
- [Shared services](services/index.md).
- [Runtime and routes](runtime/README.md).
- [Configuration and storage](storage/README.md).
- [Shared core settings](core-settings/README.md).
- [Theme tokens](theme/README.md).
- [Tab metadata and components](settings-tabs/README.md).
- [UI layers](ui-layers/README.md).
- [Catalog update configuration](addon-generic/README.md).
- [Add-on platform contracts](addon-platform/README.md).

Current guides describe the active framework. Checked-in CI inventories and size references live under [audits](../audits/README.md). Disposable test output stays under ignored `.artifacts/` and `tests/.tmp*`.

## Planned maintenance

[Identifier migration](../TODO_APERTURE_NAMING.md) tracks the coordinated naming change across shared UI, add-on markup, tests and generated audit inputs. Shared identifiers, standalone core contracts and current reports are updated; the final cross-cutting review remains pending.
