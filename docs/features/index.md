# Features

Project features use the existing feature factory, catalog and loader. Export a `*Feature` value from the selected project's `build.featuresDir`, created with `createFeature` or `createStyledFeature`. Own resources through the registries and release them during disable.

The manifest generator discovers these exports; do not import them manually into the loader or catalog. Run `npm run generate:project:manifest` for the default project, or select a project with the generator's configuration argument. Generated manifests must not be edited by hand.

## Default project inventory

<!-- GENERATED:FEATURE-INVENTORY:START -->

<!-- GENERATED:FEATURE-INVENTORY:END -->

The default project has no product features. The [Reading Desk example](../example/README.md) supplies two site-specific features through its own project configuration. See the [authoring guide](../guides/features.md) for project routes, settings and feature discovery.
