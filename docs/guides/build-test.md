# Build and test

Run commands from the repository root. `npm run build` uses root `config.json`, currently the minimal example. To build a different project, pass `--config` to every core/add-on command.

## Build Reading Desk

```powershell
npm ci
npm run build -- --config projects/reading-desk/config.json
npm run build:addons -- --config projects/reading-desk/config.json
```

The output is `projects/reading-desk/dist/reading-desk.user.js`, its minified counterpart, and `bookmark.user.js`. Install the readable core and bookmark scripts in your userscript manager; the minified core is an alternative, not an additional installation.

| Option | Effect |
| --- | --- |
| `--config <file>` | Select a project |
| `--smoke` | Build temporary deterministic output, preserving project distributions and versions |
| `--release` | Use release-mode transformation/formatting; does not publish |
| `--bump` | Explicitly change the selected version |
| `--no-bump` | Explicitly retain the version; ordinary builds already do this |

Userscript release versions belong to each project's configured `build.versionFile` (for example, `projects/reading-desk/version.json`). There is no root `version.json`. Aperture itself is versioned by root `package.json`; builds embed that framework version in the Settings footer, independently of the userscript `@version`. Core and add-on builds/versions are independent. `build:quick` is a convenience for the default project; use the two explicit commands above to select a different project reliably.

## Generate project metadata

```powershell
node -e "require('./scripts/featureManifest.cjs').generateProjectFeatureManifest({configFile:'projects/reading-desk/config.json'})"
node scripts/check-feature-manifest.cjs --config projects/reading-desk/config.json
node scripts/addon-catalog.cjs --config projects/reading-desk/config.json --check-manifest
node scripts/addon-catalog.cjs --config projects/reading-desk/config.json --write
```

Generate the feature manifest after adding/removing exported features. Catalog generation validates the selected add-on manifest. Generated files are outputs, never the place to implement behavior.

## Validate changes

```powershell
npm run lint
npm run lint:addons
npm test
npm run test:browser
npm run check:docs
npm run check:inventory
npm run build -- --config projects/reading-desk/config.json --smoke
npm run build:addons -- --config projects/reading-desk/config.json --smoke
```

Install Chromium once with `npx playwright install chromium` for browser checks. `npm test` runs architecture and project regressions; `npm run test:core` runs the standalone core export and behavior contracts. `test:browser` runs production-bundle browser fixtures; `test:visual` is its compatibility alias. These fixtures use a GM stand-in and do not prove manager installation or permissions. Active tests do not require archived source.

To inspect the local host page, run `npm run demo:reading` and open `http://localhost:4173/reading/one`. The server serves temporary scripts for manual installation; it does not auto-inject them. Use the Reading Desk [quickstart](../example/quickstart.md) and [troubleshooting](../example/troubleshooting.md).

## Where files belong

| Directory | Contents | Committed? |
| --- | --- | --- |
| `docs/` | Readable guides and API references | Yes |
| `audits/` | Accepted CI reports and fixed numerical size references | Yes |
| `scripts/` | Executable build and maintenance tools | Yes |
| `tests/.tmp*` | Disposable bundles and isolated test fixture copies | No |
| `.artifacts/` | Test logs, screenshots, browser evidence and proposed audit reports | No |

`tests/.tmp*` and `.artifacts/` are safe to delete when no tests or audits are running. Tests recreate the files they need. Keep `audits/`: checks read its accepted reports and thresholds.

Audit generation commands (`npm run audit:core`, `audit:css` and the add-on audit commands) write proposed reports to `.artifacts/audits/`. Check commands read the accepted reports under `audits/` and do not update them. Review and explicitly accept report changes using the commands in the [audit guide](../../audits/README.md).


## Continuous integration

The GitHub Actions workflow installs the committed lockfile with `npm ci` on Node.js 24, installs Chromium and its Linux dependencies, then runs unit and production-bundle browser tests. It also checks core/add-on lint, both example projects' feature manifests and add-on catalogs/structure, platform API contracts, core/CSS/add-on size baselines, documentation and inventories. Source size audits normalize line endings so Windows and Linux measure the same text. Core and add-on smoke builds cover the default example and Reading Desk without changing versions or distributions.

Browser evidence and screenshots go to ignored `.artifacts/browser/` locally and are uploaded as the `browser-evidence` workflow artifact. Tests do not rewrite documentation, accepted audit reports or history. CI checks tracked-file drift and whitespace, and has no publication step. Installed userscript-manager behavior still requires manual verification.
