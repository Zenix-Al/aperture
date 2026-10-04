# Shared core settings

Every core settings UI includes Show configuration button, Import / export settings, Feature health and Add-ons service settings. Project UI definitions contribute additional controls through the settings registry; they do not recreate these four controls. The General panel and its core section remain available alongside the permanent Add-ons tab and [project-defined tabs](../settings-tabs/README.md).

Core owns `globalSettings.configVisibility` (default true, exportable) and the existing `addons` schema, including service disable and API throttle values. These fields exist even without a project settings input. Projects cannot replace these reserved schema roots; importing the canonical add-on descriptor remains compatible, but is no longer necessary. All values use the existing project namespace, validation, safe commits and import/export machinery.

Core settings registration is idempotent and reversible through the resource manager. Visibility controls dock auto-hide while keeping keyboard access. Service disable and throttle reset require confirmation; throttle changes apply to new requests. Allow untrusted add-ons is a default-off preference under `addons.service.allowUntrusted`. Enabling it confirms the change and refreshes the existing security/lifecycle owners; metadata, scope, capability and known-catalog identity checks still apply. Config transfer excludes this preference. Explicit project development access remains supported.

The existing renderer's effect engine now runs registered metadata effects after successful persistence, alongside project-specific effect providers. Add-on registry/renderer hooks are supplied by the shared UI policy instead of the example project. Core transfer and health use the dialogs and diagnostic/storage owners.

Current validation commands are in [Build and test](../guides/build-test.md).

Feature Health reports `Framework: Aperture v<version>` using the same build-time metadata as the Settings footer. Copied reports retain this line, so diagnostics identify the installed framework rather than the current server source.
