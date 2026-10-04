# Runtime and routes

Keep `build.entry` as `src/main.js`. The shared main/loader compose project readiness, route detection and discovered features. See [architecture](../guides/architecture.md) and [project creation](../guides/create-project.md) for the working composition.

## Application input

`build.application` selects a default-exported project object. The minimal examples reuse storage bootstrap, core UI and the add-on service from [the example composition](../../projects/example/application.js).

| Input | Role |
| --- | --- |
| `ensureReady` | Required async prerequisite; use shared storage bootstrap and a terminal ready/degraded-readonly snapshot |
| `routes` | Optional JavaScript predicates/augmentation of configured isName routes |
| `state` | Plain runtime-state seed; core owns its existing state manager |
| `stateManager`, `getConfig` | Optional injected existing manager/live config provider |
| `earlyWork` | Optional bounded work before body-dependent features |
| `ui` | Optional init and toast-flush hooks using shared UI |
| `extensions` | Optional init/refresh/shutdown hooks using shared add-on owners |
| `settingsUi` | Optional metadata-registration input |
| `onStorageFailure` | Optional notice hook; does not override failed readiness |

These are inputs to the existing runtime, not another startup implementation. Keep live UI/service imports lazy in application hooks to avoid initialization cycles.

## Routes and feature loading

JSON route keys such as `isReading` derive runtime flags. Core features declare the same key in pageScopes; add-ons declare its derived name `reading`. Explicit header matches decide script installation/execution independently of route applicability.

`fast` features perform bounded early work; `waitForBody` features require body. Readiness is shared. Route transitions increment generations, abort stale work, disable/re-enable applicable resources and reconcile through the existing catalog/factory/loader. Async feature handlers check their cancellation signal after awaiting. History navigation, hash changes and page/BFCache handling stay with core.

Use the generator rather than importing features manually into the loader. See [features](../guides/features.md), [routing API](../core/routing-and-scopes.md) and [build/test](../guides/build-test.md).
