# Aperture add-ons

Reusable source lives in `addons/<addon>/src/`; project-specific entries can live in `projects/<project>/`. The selected project manifest chooses add-ons, matches, capabilities, catalogs and output paths.

Start with [add-on authoring](../docs/guides/addons.md). The [generic example](example-addon/src/main.js) demonstrates the broader adaptor/application layout; [Reading Desk bookmark](../projects/reading-desk/bookmark.js) is the compact project example. Shared bridge, runtime and ownership code lives in `addons/shared/`.

```powershell
npm run build:addons -- --config projects/reading-desk/config.json --smoke
npm run build:addons -- --config projects/reading-desk/config.json
```

Add-on builds are independent of core builds. Install both selected scripts. See [build/test](../docs/guides/build-test.md) and [platform contracts](../docs/addon-platform/README.md).

