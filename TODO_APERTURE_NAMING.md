# Aperture identifier migration

Status: waves 1–3 complete; cross-cutting audit and report refresh remain pending. This is a coordinated naming migration within the existing architecture, not a replacement runtime or another extraction phase.

## Goal and boundaries

Replace inherited product-specific identifiers in live shared UI and positive test fixtures with Aperture or neutral project names. Preserve behavior, public JavaScript exports, lifecycle, observer/queue/registry ownership, storage safety and add-on authorization/sanitization. Do not reorganize folders, replace modules, change project identity/storage keys or reset accepted thresholds. Keep the original checkout and `.baseline/frozen` immutable.

The CSS audit reads both source and tests. Regenerating reports before migrating those inputs would simply reproduce the inherited selectors. Historical source provenance and hashes describe the original authority and must not be rewritten to pretend it had different names.

## 1. Freeze the rename contract

- [x] Record an exact old/new identifier map, declarations and consumers under ignored `.artifacts/naming-migration/`.
- [x] Classify matches as live identifiers, optional product compatibility branches, positive test fixtures, negative dependency checks, provenance or incidental color substrings.
- [x] Preserve the current project-specific add-on host IDs while changing shared structural classes. Trace authored add-on CSS and sanitizer ownership checks before selecting the final map.
- [x] Record project/add-on versions and canonical storage keys before changes. Treat external CSS that targets inherited class names as affected; document the new selectors and rebuilding requirements.
- [x] Determine framework release/version impact from actual published consumers. Do not bump any versions or promise automatic compatibility as part of this task.

Wave 1 evidence is in ignored `.artifacts/naming-migration/`: `identifier-map.json`, `matches.json`, `baseline-hashes.json`, `public-exports.json`, `storage-and-versions.json`, `ownership-and-compatibility.json`, `publication-evidence.json` and `generated-output-hashes.json`. Seventy-one source/config/version inputs were copied and hash-frozen; actual storage constants were evaluated for both projects without reading or writing manager data. Both original 769-file authorities remain unchanged.

Normal project-specific add-on host, mount, content, dock-group and style IDs will remain identical. Shared classes and the private dialog callback receive Aperture names; no public JavaScript export changes are planned. Author-authored CSS targeting old shared classes needs rebuilding with the corresponding core.

No commits, tags or remotes exist in the local repository. External publication and consumers remain unverified, so release impact is conditional: published selector consumers require an explicit breaking-change/compatibility decision before shipping; an unpublished first release can adopt the finalized selectors. No version change is authorized here.

An unreferenced data fixture candidate was found and snapshotted. Wave 3 must review its disposition rather than silently removing it. Negative dependency guards, original provenance and incidental palette matches remain classified exceptions.

## 2. Rename shared UI identifiers together

- [x] Change the dock constants and class in [configButton.js](src/ui/components/configButton.js), keeping its timers, listener ownership, focus and slide behavior.
- [x] Update matching selectors in [startup.css](src/ui/assets/startup.css) and [accessibility.css](src/ui/assets/accessibility.css). Shared prefix: `aperture-page-dock`.
- [x] Rename the private close callback in [dialog.js](src/ui/components/dialog.js), preserving cancellation, replacement and teardown.
- [x] Update host/slot constants in [addonUiHosts.js](src/ui/components/addons/addonUiHosts.js) and matching classes in [addonDockGroup.js](src/ui/components/addons/addonDockGroup.js), [addonMount.js](src/ui/components/addons/addonMount.js) and [addonDialog.js](src/ui/components/addons/addonDialog.js). Shared prefix: `aperture-addon`.
- [x] Replace the optional product ID-prefix branches in those modules and [addonStyle.js](src/ui/components/addons/addonStyle.js) with project-derived IDs. Preserve current default IDs; remove unused imports only after tracing consumers. Do not remove unrelated generic compatibility behavior.
- [x] Update [example dock markup](addons/example-addon/src/ui/dock.html), [example CSS](addons/example-addon/src/ui/example.css) and the generic comment in [htmlUtils.js](addons/shared/htmlUtils.js).
- [x] Remove the unused inherited debug-global allowance from [eslint.config.mjs](eslint.config.mjs).

Wave 2 changed 13 live files. Public exports, the other 58 frozen inputs, storage, sanitizer, versions, distributions and measured audit inputs remain unchanged. Core/add-on lint and non-bumping core/add-on smoke builds passed. The architectural suite passed 106 tests and failed 3 on unmigrated positive selectors (dock class, CSS inventory and dialog ownership fixture); the separately executed project suites passed all 178 tests. The combined `npm test` command therefore remains failing until wave 3 updates its fixtures. Browser verification and report refresh remain pending for wave 4. Both original 769-file authorities passed preservation checks. Evidence is under ignored `.artifacts/naming-migration/`.

## 3. Migrate tests without weakening coverage

- [x] Update positive DOM fixtures, selectors and class assertions in the core/config/integration groups and add-on/theme/Reading Desk browser tests.
- [x] Use neutral foreign-project storage keys for namespace-isolation and diagnostic-redaction fixtures in [storage.test.cjs](tests/storage.test.cjs). Retain all original isolation, redaction and write-denial assertions.
- [x] Neutralize old product wording in fixture markup and test descriptions.
- [x] Review explicit negative dependency checks. Following subsequent user direction, remove old-name-only assertions and old-name alternatives from mixed checks; retain metadata, logging, module-boundary and concrete retired-dependency checks.
- [x] Keep palette values unchanged, including hexadecimal values that incidentally match a text search.

Wave 3 migrated positive selectors, foreign-project storage fixtures and test descriptions. Subsequent user direction removed old-name absence checks and moved original-source comparisons out of the active suite. The current `core-contract` tests pin Aperture exports and behavior directly, with no archived-checkout dependency. The unused product storage fixture was retired after consumer review; its byte-identical snapshot remains in the migration evidence.

Current validation passed: 272 unit tests, 14 browser tests and 15 static checks. The count decreased by 15 duplicate runs against the original source; the Aperture behavioral assertions remain. Both immutable source authorities still match all 769 recorded hashes. Logs are under `.artifacts/standalone-framework/`; historical extraction evidence has been moved outside the repository into a private archive. No runtime, storage, versions or distributions changed during this documentation/contract cleanup.

## 4. Verify behavior and refresh truthful evidence

Current API/core/CSS/add-on reports have been regenerated. The CSS check now verifies Aperture's deterministic inventory without comparing it to archived product selectors; configured size limits and numerical core-reduction thresholds remain unchanged. The complete wave 4 review remains pending; its checklist is not marked complete by the independently authorized contract/documentation cleanup.

- [ ] Run core/add-on lint, `npm test` and `npm run test:browser`.
- [ ] Verify normal/reduced-motion dock behavior, desktop/mobile footer and navigation, core dialogs and Feature Health.
- [ ] Verify add-on dock mounts, page panels, dialogs, authored CSS, cross-owner/sibling sanitization, unregistration and complete cleanup.
- [ ] Verify storage continuity and project isolation. DOM identifier changes must not migrate or reset persisted settings.
- [ ] Regenerate the affected measured reports from the renamed source and tests using the existing audit commands. Preserve accepted thresholds; describe naming-related report differences rather than hiding them.
- [ ] Run manifest/catalog/API/baseline/size/docs/inventory checks and non-bumping core/add-on smoke builds through the existing maintenance checks.
- [ ] Confirm both original 769-file authorities remain unchanged, and no distributions, project versions or framework version were modified.

## Completion criteria

- No inherited product identifier is used positively by the live UI or generic fixtures.
- Exact residual matches are classified; provenance, negative guards and unchanged color values are not presented as runtime coupling.
- Current authoring docs describe the Aperture selectors and affected add-on CSS. Generated current reports reflect the new inputs; historical evidence remains byte-preserved.
- Existing architecture and regression contracts remain intact. Report failures and unverified manager behavior honestly.
