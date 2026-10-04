# Core provider inputs

Each independently bundled project has its own core module graph. The framework supplies feature lifecycle, observers, queues, resource/listener/style registries, route cancellation, diagnostics and teardown. Project policy enters that graph through provider inputs.

`configureCoreContext(inputs)` in `src/core/coreContext.js` accepts:

| Input | Purpose |
| --- | --- |
| `id` | Stable application identity; a configured graph cannot switch to another identity |
| `getConfig` | Function returning the current project configuration |
| `stateManager` | Manager exposing `get` and `set` for runtime state |
| `pageDefinitions` | Route definitions used by shared page detection |
| `notify` | Optional notification function, or `null` |
| `shutdownAddons` | Optional add-on shutdown function, or `null` |

Unknown fields and invalid provider types throw. `getCoreContext()` returns the frozen provider object; the configuration returned by `getConfig` remains live. Bundle separate applications independently so their resources and state stay isolated.

Normal projects configure these inputs through [application composition](../runtime/README.md), rather than importing project modules into core primitives. Features use the [feature factories](featureFactory.md) and release resources through the existing registries.

`npm run test:core` covers exports, provider validation, lifecycle failure/cancellation, observer batching/profiling, queue policies, resource/style/listener cleanup, bridge requests and diagnostics. `npm run test:core:browser` checks independently bundled applications in Chromium.
