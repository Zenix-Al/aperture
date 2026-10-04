# Project configuration reference

One JSON file selects one project. The CLI defaults to root `config.json`; pass `--config projects/<project>/config.json` to select another. Every path in the file is repository-relative, regardless of where the config file lives. Unknown keys, duplicate JSON keys, invalid inputs, unsafe paths and source/output collisions are rejected before publishing outputs.

For a complete usable configuration and accompanying modules, follow [Create a site project](../guides/create-project.md). For command examples, see [build/test](../guides/build-test.md).

## Top-level fields

| Field | Contract |
| --- | --- |
| `schemaVersion` | Required, exactly 1; separate from persisted settings schema |
| `id`, `storageNamespace` | Required stable lowercase identifiers, 2-64 characters, beginning with a letter; letters, digits, underscore and hyphen |
| `metadata` | Required userscript header fields below |
| `build` | Required source/output and manifest paths below |
| `routes` | Required nonempty map with `isName` route keys |
| `theme` | Required theme directory name; selects `themes/<name>/index.css` |
| `addonUpdates` | Optional object with `catalogURL`; omission/empty object uses bundled catalog without remote checks |

Display-name changes retain storage. ID/namespace changes select a fresh dataset and leave old data in place. Public build inputs are visible in generated scripts; do not put secrets in them.

## Userscript metadata

Required: `name`, `namespace`, `description`, `author`, `license`, nonempty `matches`, nonempty `grants` and `runAt`. Optional: `icon`, `source`, `homepage`, `support`, `updateURL`, `downloadURL`, `includes`, `excludes`, `connect`.

Text fields are nonempty single lines with no surrounding whitespace or control characters. URLs use HTTP(S) without embedded credentials. Update/support URLs have no implicit defaults.

Match patterns support HTTP, HTTPS or wildcard scheme; exact/wildcard hosts; optional ports; and absolute glob paths. Regex includes, file URLs and all-URLs shortcuts are rejected. Header matches determine where the manager executes the script; runtime routes are an additional applicability gate.

Grants use the existing allowlist of legacy/modern GM APIs, unsafeWindow, or none alone. `runAt` accepts document-start, document-body, document-end, document-idle and context-menu. Arbitrary manager tags, require and resource are outside this schema.

## Build paths

| Field | Meaning |
| --- | --- |
| `entry` | Core entry; keep `src/main.js` |
| `featuresDir` | Existing project feature directory |
| `featureManifest` | Generated selected-feature manifest |
| `versionFile` | Core version object with nonnegative integer major/minor/patch |
| `outputDir`, `outputName` | Destination and lowercase filename stem |
| `addonsManifest` | Existing selected add-on manifest, including an empty addons array when none are selected |
| `catalogDir`, `cacheFile` | Generated catalog directory and add-on build cache |
| `application` | Optional project composition module; an operational project supplies readiness through it |
| `settings` | Optional project schema/defaults/effects module |
| `ui` | Optional project tabs, sections, components, hooks and zIndex module |
| `addons` | Optional catalog/security/extension policy module |

The first nine fields are required. Paths reject traversal, absolute paths, backslashes, reserved roots, device names and symlink escape. Source files cannot be generated/distribution discovery inputs. Missing/corrupt version data fails rather than resetting. Core outputs are `<outputName>.user.js` and `<outputName>.uglified.user.js`; release mode formats the readable target with the existing transformations.

Application/settings/UI modules supply inputs to shared owners. See [runtime](../runtime/README.md), [settings/UI](../guides/settings-ui.md), [tabs](../settings-tabs/README.md) and [layers](../ui-layers/README.md).

## Routes and themes

Each JSON route requires nonempty `hostEquals` or `hostIncludes`. Prefer exact hosts. Optional `pathStartsWith`, `pathEquals`, `hrefIncludes` and `pathPattern` arrays use the existing matcher; fields combine with AND, alternatives within arrays with OR. JSON contains no function strings. JavaScript predicates belong in application route inputs.

Core feature scope `isReading` corresponds to add-on scope `reading`. Route changes use the existing detection, generation/cancellation and loader reconciliation.

The default theme must exist and validate even when another theme is selected. Selection has no missing-theme fallback. See [theme contract](../theme/README.md) for required color tokens and optional dock overrides; zIndex belongs to UI input rather than theme colors.

## Add-on manifest and updates

The selected manifest contains only an `addons` array. Each entry supplies ID/name/description/version, entry/outfile, matches/grants/runAt, pageScopes/runtimeMode/requiresCore and capabilities. Versions are independent from core. Permissions and update/download URLs never inherit by fallback; other display metadata may inherit project values. Core-required activation must fit the core's selected matches/scopes. Catalogs remain sorted and hash-addressed through the existing tools.

See [add-on authoring](../guides/addons.md), [platform contracts](../addon-platform/README.md) and [catalog updates](../addon-generic/README.md). Listing an add-on establishes a project allowlist, not permission for arbitrary scripts. Configuring remote URLs neither publishes artifacts nor grants manager permissions.
