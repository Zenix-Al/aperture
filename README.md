# Aperture

Aperture is a framework for building site-specific userscripts. It supplies bootstrap and route handling, feature lifecycle, a shared observer and task queue, resource registries, safe storage, settings UI, themes, diagnostics and an add-on platform. Projects supply the site's matches, routes, selectors, features and configuration.

## Start here

- [Run and build Reading Desk](docs/example/quickstart.md): a complete local project with a bookmark add-on.
- [Create your own project](docs/guides/create-project.md): files, config, a feature, settings and build commands.
- [Understand the architecture](docs/guides/architecture.md): shared infrastructure and project inputs.
- [Documentation index](docs/README.md): authoring guides and API references.

## Build a project

From the repository root:

```powershell
npm ci
npm run build -- --config projects/reading-desk/config.json
npm run build:addons -- --config projects/reading-desk/config.json
```

Install `projects/reading-desk/dist/reading-desk.user.js` and `bookmark.user.js` in your userscript manager. Run `npm run demo:reading` to serve the local site at `http://localhost:4173/reading/one`.

`npm run build` without `--config` selects root `config.json`, currently the minimal example. Core and add-ons build separately. Ordinary builds retain versions; `--bump` requests a version change. `--smoke` validates temporary output without updating project distributions. See [build/test commands](docs/guides/build-test.md).

Aperture's framework version comes from root `package.json` and appears in the Settings footer. Each project and add-on keeps its own userscript release version; see [versioning and compatibility](docs/guides/architecture.md).

## Project and framework boundaries

| Location | Purpose |
| --- | --- |
| `projects/<project>/` | Site config, application composition, schema, UI metadata and features |
| `src/main.js`, `src/loader.js` | Shared bootstrap and feature loading |
| `src/core/` | Lifecycle, route cancellation, observer, queues and owned resources |
| `src/config/`, `src/services/` | Schema, persistence safety and cross-feature services |
| `src/ui/` | Shadow settings UI, dock, dialogs, toasts and owned add-on mounts |
| `addons/` | Reusable add-on source and shared client/runtime machinery |
| `themes/` | Build-selected token themes |
| `scripts/`, `build/` | Validation, discovery, catalogs and builders |

Features use `createFeature` or `createStyledFeature` and clean up resources during disable. Settings use the shared schema/write gate. Project tabs are metadata-driven; General and Add-ons are permanent core tabs. Edit source inputs, never generated userscripts.

## Validate

```powershell
npm run lint
npm run lint:addons
npm test
npm run test:browser
npm run check:docs
npm run check:inventory
```

Browser checks use production-bundle fixtures with a GM stand-in. Installed userscript-manager behavior requires a separate manual check.

## License

Aperture is licensed under [MIT](LICENSE). Preserve the existing copyright and license notice when redistributing. Dependencies retain their own licenses.
